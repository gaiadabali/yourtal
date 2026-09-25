export interface ListingPriceRevisionRecord {
  readonly id: string;
  readonly listingId: string;
  readonly previousSettlementValueMinor: number;
  readonly newSettlementValueMinor: number;
  readonly previousPriceInPoints: number;
  readonly newPriceInPoints: number | null;
  readonly requestedBy: string;
  readonly reason: string | null;
  readonly createdAt: string;
}

/**
 * Read-only access to the settlement-value audit trail (docs/17 section
 * 2.1). The write side is NOT here: `ListingRepository.updateSettlementValue`
 * writes a listing's own audit row in the same transaction as the value
 * change, because a repricing that "succeeded" with no audit trail is a
 * silent partial completion. A second, non-transactional way to write this
 * table would be a second way for that guarantee to be skipped.
 */
export interface ListingPriceRevisionRepository {
  listForListing(listingId: string): Promise<ListingPriceRevisionRecord[]>;
}

export const LISTING_PRICE_REVISION_REPOSITORY = Symbol("LISTING_PRICE_REVISION_REPOSITORY");
