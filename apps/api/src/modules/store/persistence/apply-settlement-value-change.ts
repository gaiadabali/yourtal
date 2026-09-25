import { and, eq } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { assembleListing } from "./listing-assembler";
import { listingPriceRevisions } from "./schema/listing-price-revision.table";
import { listings } from "./schema/listing.table";
import type { SettlementValueChange } from "./listing.repository";

/** The subset of `AppDb` this needs — satisfied by both a live handle and a transaction. */
type Db = Pick<AppDb, "select" | "update" | "insert">;

/**
 * The one place `store.listings.settlement_value_minor` is written and its
 * `store.listing_price_revision` audit row recorded, in the SAME
 * transaction. Shared by two callers:
 *
 *  - `DrizzleListingRepository.updateSettlementValue` — the direct-apply
 *    path, for a non-material change.
 *  - `DrizzleSettlementDecreaseRequestRepository.approve` (YT-0575) — the
 *    two-person-approval path, once a second person has claimed the request.
 *
 * A second, slightly different copy of "update the value, then write the
 * audit row" would be a second place for "repricing without an audit trail"
 * to reappear (docs/13c) — exactly the failure mode this table exists to
 * prevent.
 *
 * `settlementDecreaseRequestId` is `null` for a direct edit and the
 * originating request's id for an approval — the only thing that
 * distinguishes the two kinds of row in `listing_price_revision`.
 *
 * Returns `null` if `listingId` does not belong to `merchantId` — the same
 * "not found" sentinel `updateSettlementValue` always returned, now shared.
 */
export async function applySettlementValueChange(
  db: Db,
  merchantId: string,
  listingId: string,
  newSettlementValueMinor: number,
  requestedBy: string,
  reason: string,
  settlementDecreaseRequestId: string | null,
): Promise<SettlementValueChange | null> {
  const [existing] = await db
    .select()
    .from(listings)
    .where(and(eq(listings.id, listingId), eq(listings.merchantId, merchantId)))
    .limit(1);
  if (existing === undefined) return null;

  const previous = await assembleListing(db, existing);
  if (previous === null) return null;

  // price_in_points is deliberately untouched -- see this module's
  // migration header. Only settlement_value_minor moves here.
  const [updatedRow] = await db
    .update(listings)
    .set({ settlementValueMinor: newSettlementValueMinor })
    .where(and(eq(listings.id, listingId), eq(listings.merchantId, merchantId)))
    .returning();
  if (updatedRow === undefined) return null;

  const updated = await assembleListing(db, updatedRow);
  if (updated === null) return null;

  await db.insert(listingPriceRevisions).values({
    listingId,
    currency: existing.currency,
    previousSettlementValueMinor: existing.settlementValueMinor,
    newSettlementValueMinor,
    previousPriceInPoints: existing.priceInPoints,
    newPriceInPoints: null,
    requestedBy,
    reason,
    settlementDecreaseRequestId,
  });

  return { previous, updated };
}
