import { sql } from "drizzle-orm";
import type { MarketplacePaymentsDriver } from "@yourtal/drivers/marketplace-payments";
import type { VoucherInternalClient } from "../../../shared/voucher-client/voucher-internal-client";
import type { AuctionStore } from "../persistence/auction-store";

export interface SettleDeps {
  readonly store: AuctionStore;
  readonly payments: MarketplacePaymentsDriver;
  readonly vouchers: VoucherInternalClient;
}

/** Who gets a receipt once an auction is settled. */
export interface SettledParties {
  readonly auctionId: string;
  readonly outcome: "sold" | "unsold" | "cancelled";
  readonly sellerId: string;
  readonly winnerId: string | null;
  readonly charityId: string;
  readonly charityAdminId: string | null;
  readonly amountMinor: number | null;
  readonly currency: "AUD" | "IDR";
}

/**
 * 13.22.c: close one auction, effectively once. Under the auction's row lock:
 * capture the highest hold straight into the charity's own account (a
 * failed capture falls to the next bid), release every other hold, hand the
 * voucher to the winner (the charity if nobody bid, the seller on a cancel),
 * and write the one settlement row. Returns null when there is nothing to do.
 */
export async function settleAuction(
  deps: SettleDeps,
  auctionId: string,
  cancel?: { readonly reason: string },
): Promise<SettledParties | null> {
  return deps.store.db.transaction(async (tx) => {
    await deps.store.lock(tx, auctionId);
    const auction = await deps.store.get(tx, auctionId);
    if (auction === null || auction.state !== "open") return null;
    if (cancel === undefined && auction.endsAt.getTime() > Date.now()) return null;

    const charity = await deps.store.charity(auction.charityId, auction.region);
    if (charity === null)
      throw new Error(`auction ${auctionId}: its charity is no longer approved`);

    const bids = await deps.store.heldBids(tx, auctionId);
    let winner: (typeof bids)[number] | null = null;
    let capture: { captureReference: string; destinationReference: string } | null = null;
    const failed = new Set<string>();
    if (cancel === undefined) {
      for (const bid of bids) {
        const captured = await deps.payments.capture({
          idempotencyKey: `auction-capture:${auctionId}:${bid.id}`,
          holdReference: bid.holdReference,
          amountMinor: bid.amountMinor,
          currency: auction.currency,
          destinationReference: charity.payoutReference,
        });
        if (captured.isOk()) {
          winner = bid;
          capture = captured.value;
          await deps.store.setBidState(tx, bid.id, "captured");
          break;
        }
        failed.add(bid.id);
        await deps.store.setBidState(tx, bid.id, "capture_failed");
      }
    }
    // Every other hold is let go; a failed capture's hold is released too.
    for (const bid of bids) {
      if (bid.id === winner?.id) continue;
      const released = await deps.payments.release(bid.holdReference);
      if (released.isOk() && !failed.has(bid.id)) {
        await deps.store.setBidState(tx, bid.id, "released");
      }
    }

    const outcome = cancel !== undefined ? "cancelled" : winner !== null ? "sold" : "unsold";
    const owner =
      winner !== null
        ? winner.bidderId
        : cancel !== undefined
          ? auction.sellerId
          : charity.adminUserId;
    if (owner === null) throw new Error(`auction ${auctionId}: the charity has no administrator`);
    const released = await deps.vouchers.escrowRelease({ auctionId, ownerId: owner });
    if (released.isErr())
      throw new Error(`auction ${auctionId}: escrow release: ${released.error.code}`);

    await tx.execute(sql`
      INSERT INTO auction.settlement (auction_id, outcome, winning_bid_id, winner_id, amount_minor,
        currency, charity_id, capture_reference, destination_reference, voucher_owner_id)
      VALUES (${auctionId}, ${outcome}, ${winner?.id ?? null}, ${winner?.bidderId ?? null},
        ${winner?.amountMinor ?? null}, ${auction.currency}, ${charity.id},
        ${capture?.captureReference ?? null}, ${capture?.destinationReference ?? null}, ${owner})
    `);
    await tx.execute(sql`
      UPDATE auction.auction SET state = ${outcome === "cancelled" ? "cancelled" : "settled"},
             outcome = ${outcome}, cancel_reason = ${cancel?.reason ?? null}, settled_at = now()
       WHERE id = ${auctionId}
    `);
    const parties: [string, string | null][] = [
      ["seller", auction.sellerId],
      ["winner", winner?.bidderId ?? null],
      ["charity", charity.adminUserId],
    ];
    for (const [party, recipient] of parties) {
      if (recipient === null) continue;
      await tx.execute(sql`
        INSERT INTO auction.receipt (auction_id, party, recipient_id) VALUES (${auctionId}, ${party}, ${recipient})
        ON CONFLICT DO NOTHING
      `);
    }
    return {
      auctionId,
      outcome,
      sellerId: auction.sellerId,
      winnerId: winner?.bidderId ?? null,
      charityId: charity.id,
      charityAdminId: charity.adminUserId,
      amountMinor: winner?.amountMinor ?? null,
      currency: auction.currency,
    };
  });
}
