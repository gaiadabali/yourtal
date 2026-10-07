const TRANSLATED_CODES = new Set([
  "unavailable",
  "forbidden",
  "approval_refused",
  "decrease_already_pending",
  "not_a_material_decrease",
  "unchanged",
  "prohibited_category",
  "audience_must_be_adult",
  "invalid_locations",
  "listing_pricing_unavailable",
  "persistence_unavailable",
]);

/** The `studio.inventory.error.*` key for an API error code; anything unlisted reads as the generic message. */
export function inventoryErrorKey(code: string): string {
  return TRANSLATED_CODES.has(code) ? code : "generic";
}
