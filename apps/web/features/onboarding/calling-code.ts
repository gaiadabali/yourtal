import type { Region } from "@yourtal/contracts/region";

/**
 * The country's mobile calling code prefix, shown next to the phone field
 * in `phone-verification-flow.tsx`. Not part of the region contract
 * (`@yourtal/contracts/region`'s `REGION_CONFIG` carries locale, currency
 * and country name, not a calling code), so this is this feature's own,
 * small piece of data — not a duplicate of anything YT-0405 owns.
 * `Region` is imported type-only, so this file is free to import from a
 * "use client" leaf.
 */
export function callingCodeForRegion(region: Region): string {
  switch (region) {
    case "AU":
      return "+61";
    case "ID":
      return "+62";
    default: {
      const exhaustive: never = region;
      return exhaustive;
    }
  }
}
