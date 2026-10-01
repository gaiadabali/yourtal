import { Inject, Injectable, Logger } from "@nestjs/common";
import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { Auction } from "@yourtal/contracts/auction/auction";
import type { EmailDriver } from "@yourtal/drivers/email";
import type { MarketplacePaymentsDriver } from "@yourtal/drivers/marketplace-payments";
import { EMAIL_DRIVER } from "../../shared/drivers/email-driver.module";
import {
  VOUCHER_INTERNAL_CLIENT,
  type VoucherInternalClient,
} from "../../shared/voucher-client/voucher-internal-client";
import { GIFT_PARTY_READER, type GiftPartyReader } from "../wallet/gift-party-reader";
import { AUCTION_STORE, type AuctionRow, type AuctionStore } from "./persistence/auction-store";
import { notFound } from "./use-cases/auction-errors";
import { listVoucher, placeBid } from "./use-cases/list-and-bid";
import { presentAuction } from "./use-cases/present-auction";
import { sendReceipts } from "./use-cases/send-receipts";
import { settleAuction } from "./use-cases/settle-auction";

export const MARKETPLACE_PAYMENTS = Symbol("MARKETPLACE_PAYMENTS");

const SWEEP_MS = 30_000;

/** 13.22: charity auctions, and the sweep that closes them when they end. */
@Injectable()
export class AuctionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuctionService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(AUCTION_STORE) readonly store: AuctionStore,
    @Inject(VOUCHER_INTERNAL_CLIENT) readonly vouchers: VoucherInternalClient,
    @Inject(MARKETPLACE_PAYMENTS) readonly payments: MarketplacePaymentsDriver,
    @Inject(GIFT_PARTY_READER) private readonly parties: GiftPartyReader,
    @Inject(EMAIL_DRIVER) private readonly email: EmailDriver,
  ) {}

  onModuleInit(): void {
    // Tests drive settlement themselves.
    if (process.env["NODE_ENV"] === "test") return;
    this.timer = setInterval(() => void this.settleDue(), SWEEP_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  async list(sellerId: string, voucherId: string, charityId: string): Promise<Auction> {
    const seller = await this.parties.byUserId(sellerId);
    const auctionId = await listVoucher(this, seller, voucherId, charityId);
    return this.view(auctionId, sellerId);
  }

  async bid(bidderId: string, auctionId: string, amountMinor: number): Promise<Auction> {
    await this.settleIfDue(auctionId);
    await placeBid(this, await this.parties.byUserId(bidderId), auctionId, amountMinor);
    return this.view(auctionId, bidderId);
  }

  async view(auctionId: string, viewerId: string | null): Promise<Auction> {
    await this.settleIfDue(auctionId);
    const row = await this.store.get(this.store.db, auctionId);
    if (row === null) throw notFound();
    return this.present(row, viewerId);
  }

  async browse(
    region: "AU" | "ID",
    viewerId: string,
    filter: { charityId?: string; category?: string },
  ): Promise<Auction[]> {
    const rows = await this.store
      .list(sql`a.region = ${region} AND a.state = 'open' AND a.ends_at > now()
      AND (${filter.charityId ?? null}::uuid IS NULL OR a.charity_id = ${filter.charityId ?? null}::uuid)
      AND (${filter.category ?? null}::text IS NULL OR a.category = ${filter.category ?? null})`);
    return Promise.all(rows.map((row) => this.present(row, viewerId)));
  }

  async mine(viewerId: string, which: "bids" | "listings"): Promise<Auction[]> {
    const rows = await this.store.list(
      which === "listings"
        ? sql`a.seller_id = ${viewerId}`
        : sql`EXISTS (SELECT 1 FROM auction.bid b WHERE b.auction_id = a.id AND b.bidder_id = ${viewerId})`,
    );
    return Promise.all(rows.map((row) => this.present(row, viewerId)));
  }

  /** Staff cancel (13.22.d's backend): every hold released, voucher back to the seller. */
  async cancel(auctionId: string, reason: string): Promise<boolean> {
    const settled = await settleAuction(this, auctionId, { reason });
    if (settled !== null) await sendReceipts(this.email, this.parties, settled);
    return settled !== null;
  }

  /** 13.22.g: every open auction, every region, for the staff console. */
  async openForStaff(): Promise<Auction[]> {
    const rows = await this.store.list(sql`a.state = 'open'`, 200);
    return Promise.all(rows.map((row) => this.present(row, null)));
  }

  async settleDue(): Promise<number> {
    let closed = 0;
    for (const id of await this.store.dueIds()) {
      try {
        if (await this.settleIfDue(id)) closed += 1;
      } catch (error) {
        this.logger.error(`settling auction ${id} failed: ${String(error)}`);
      }
    }
    return closed;
  }

  private async settleIfDue(auctionId: string): Promise<boolean> {
    const settled = await settleAuction(this, auctionId);
    if (settled === null) return false;
    await sendReceipts(this.email, this.parties, settled).catch((error: unknown) => {
      this.logger.warn(`receipts for auction ${auctionId}: ${String(error)}`);
    });
    return true;
  }

  private async present(row: AuctionRow, viewerId: string | null): Promise<Auction> {
    const highest = viewerId === null ? null : await this.store.highestBidBy(row.id, viewerId);
    return presentAuction(row, viewerId, highest);
  }
}
