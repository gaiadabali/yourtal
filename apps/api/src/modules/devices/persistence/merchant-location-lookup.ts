/**
 * Confirms a location belongs to a business BEFORE the insert, so a bad
 * `locationId` is a clean 404 rather than the DB's own FK-violation 500 —
 * the composite FK in the migration is the real, unbypassable guarantee;
 * this is just a friendlier first check. Same cross-module-read shape as
 * `store/persistence/business-region-lookup.ts` (a port, not a repository
 * import, so this module gains no NestJS dependency on `store`).
 */
export interface MerchantLocationLookup {
  belongsToBusiness(locationId: string, businessId: string): Promise<boolean>;
}

export const MERCHANT_LOCATION_LOOKUP = Symbol("MERCHANT_LOCATION_LOOKUP");
