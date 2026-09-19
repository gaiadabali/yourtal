import type { Region } from "@yourtal/contracts/region";
import { REGION_CONFIG } from "@yourtal/contracts/region";
import type { MerchantCurrency, MerchantLocale } from "./merchant-device";

/**
 * SERVER-ONLY seam onto the region contract (`@yourtal/contracts/region`,
 * YT-0405 — being built in parallel with this ticket, per the brief:
 * "It may not exist yet; build against the contract, do not stub it").
 * `REGION_CONFIG` is a value import next to a Zod schema
 * (`regionSchema`) in that module, so importing it here executes the
 * whole module and pulls in Zod's runtime — the same reasoning
 * `packages/contracts/src/money/money-format.ts`'s doc comment gives for
 * splitting `formatIdr` out of `money.ts`. This file is therefore imported
 * ONLY by `merchant-data.ts` (a Server Component data module — see
 * docs/13b-typescript-standards.md §8), which resolves it once per
 * request and passes plain primitives (`locale`, `currency`,
 * `countryName`) down through `MerchantDevice`. No "use client" file in
 * this feature imports this module, or `@yourtal/contracts/region`, at
 * all — that is what keeps the whole feature buildable and testable even
 * if this one file's import target has not landed yet, and what stops
 * that ~96 KB gz Zod cost ever reaching the client bundle.
 */
export interface MerchantRegionInfo {
  locale: MerchantLocale;
  currency: MerchantCurrency;
  countryName: string;
}

export function resolveMerchantRegionInfo(region: Region): MerchantRegionInfo {
  const config = REGION_CONFIG[region];
  return { locale: config.locale, currency: config.currency, countryName: config.countryName };
}
