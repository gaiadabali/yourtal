import { randomUUID } from "node:crypto";
import { BadGatewayException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import {
  AUCTION_DURATION_HOURS,
  AUCTION_EXTENSION_SECONDS,
  auctionReserve,
  minimumNextBid,
} from "@yourtal/contracts/auction/auction";
import type { MarketplacePaymentsDriver } from "@yourtal/drivers/marketplace-payments";
import { ageBandFrom, ageYearsFrom } from "@yourtal/jurisdiction/age";
import type { VoucherInternalClient } from "../../../shared/voucher-client/voucher-internal-client";
import type { GiftParty } from "../../wallet/gift-party-reader";
import type { AuctionStore } from "../persistence/auction-store";
import { notFound, refusal } from "./auction-errors";

/** A bid inside the last 2 minutes extends the close; at most this many times (an hour). */
const MAX_EXTENSIONS = 30;
/** A voucher must outlive its auction by a day, so the winner can still use it. */
const MIN_VOUCHER_LIFE_MS = (AUCTION_DURATION_HOURS + 24) * 3_600_000;

export function isEligible(party: GiftParty | null): party is GiftParty {
  return (
    party !== null &&
    !party.suspended &&
    ageBandFrom(ageYearsFrom(party.dateOfBirth, new Date())) === "adult"
  );
}

/** 13.22.a: void the seller's voucher into escrow and open a 3-day auction. */
export async function listVoucher(
  deps: { store: AuctionStore; vouchers: VoucherInternalClient },
  seller: GiftParty | null,
  voucherId: string,
  charityId: string,
): Promise<string> {
  if (!isEligible(seller)) throw refusal("seller_ineligible", "This account cannot list vouchers.");
  const charity = await deps.store.charity(charityId, seller.region);
  if (charity === null) throw refusal("charity_unavailable", "No such charity in your region.");

  const held = await deps.vouchers.get({ voucherId, ownerId: seller.userId });
  if (held.isErr()) throw notFound();
  if (new Date(held.value.expiresAt).getTime() - Date.now() < MIN_VOUCHER_LIFE_MS) {
    throw refusal("voucher_not_unused", "This voucher expires too soon to auction.");
  }

  const auctionId = randomUUID();
  const escrow = await deps.vouchers.escrowHold({
    auctionId,
    voucherId,
    sellerId: seller.userId,
    region: seller.region,
  });
  if (escrow.isErr()) {
    const { code } = escrow.error;
    if (code === "not_found") throw notFound();
    if (code === "not_transferable")
      throw refusal("voucher_not_transferable", escrow.error.message);
    if (code === "already_gifted")
      throw refusal("voucher_already_transferred", escrow.error.message);
    if (code === "not_unused" || code === "holdback")
      throw refusal("voucher_not_unused", escrow.error.message);
    throw new BadGatewayException({ code, message: "The voucher service is unavailable." });
  }

  const e = escrow.value;
  await deps.store.insert({
    id: auctionId,
    region: seller.region,
    currency: e.currency,
    sellerId: seller.userId,
    charityId: charity.id,
    sourceVoucherId: e.sourceVoucherId,
    voucherId: e.voucherId,
    listingId: e.listingId,
    title: e.title,
    merchantName: e.merchantName,
    category: await deps.store.listingCategory(e.listingId),
    faceValueMinor: e.faceValueMinor,
    voucherExpiresAt: e.voucherExpiresAt,
    reserveMinor: auctionReserve(e.faceValueMinor),
    endsAt: new Date(Date.now() + AUCTION_DURATION_HOURS * 3_600_000),
  });
  return auctionId;
}

/**
 * 13.22.b: one bid. The auction row is locked for the whole bid, so bids
 * on one auction are processed one at a time; the hold is placed before
 * the bid is recorded, and a bidder's own earlier hold is released.
 */
export async function placeBid(
  deps: { store: AuctionStore; payments: MarketplacePaymentsDriver },
  bidder: GiftParty | null,
  auctionId: string,
  amountMinor: number,
): Promise<void> {
  await deps.store.db.transaction(async (tx) => {
    await deps.store.lock(tx, auctionId);
    const auction = await deps.store.get(tx, auctionId);
    if (auction === null) throw notFound();
    if (!isEligible(bidder) || bidder.region !== auction.region) {
      throw refusal("bidder_ineligible", "This account cannot bid here.");
    }
    if (bidder.userId === auction.sellerId) throw refusal("own_auction", "This is your listing.");
    const now = Date.now();
    if (auction.state !== "open" || auction.endsAt.getTime() <= now) {
      throw refusal("auction_closed", "This auction has closed.");
    }
    const minimum = minimumNextBid(
      auction.currency,
      auction.reserveMinor,
      auction.currentAmountMinor,
    );
    if (amountMinor < minimum)
      throw refusal("bid_too_low", `The minimum bid is ${String(minimum)}.`);

    const bidId = randomUUID();
    const hold = await deps.payments.hold({
      idempotencyKey: `auction-bid:${bidId}`,
      amountMinor,
      currency: auction.currency,
      reference: `auction:${auctionId}`,
    });
    if (hold.isErr()) throw refusal("payment_declined", "The payment hold was declined.");

    for (const earlier of await deps.store.heldBids(tx, auctionId, bidder.userId)) {
      const released = await deps.payments.release(earlier.holdReference);
      if (released.isOk()) await deps.store.setBidState(tx, earlier.id, "released");
    }
    await tx.execute(sql`
      INSERT INTO auction.bid (id, auction_id, region, currency, bidder_id, amount_minor, hold_reference)
      VALUES (${bidId}, ${auctionId}, ${auction.region}, ${auction.currency}, ${bidder.userId},
              ${amountMinor}, ${hold.value.holdReference})
    `);
    const extend =
      auction.endsAt.getTime() - now < AUCTION_EXTENSION_SECONDS * 1000 &&
      auction.extensions < MAX_EXTENSIONS;
    await tx.execute(sql`
      UPDATE auction.auction
         SET current_amount_minor = ${amountMinor}, bid_count = bid_count + 1, leader_bid_id = ${bidId},
             ends_at = CASE WHEN ${extend} THEN now() + make_interval(secs => ${AUCTION_EXTENSION_SECONDS})
                            ELSE ends_at END,
             extensions = extensions + CASE WHEN ${extend} THEN 1 ELSE 0 END
       WHERE id = ${auctionId}
    `);
  });
}
