/**
 * The currencies this platform prices in — deliberately dependency-free.
 *
 * No Zod here, and no import from `../region/region`. Both would put a
 * runtime edge on this module, and `money-format.ts` value-imports it: that
 * file exists precisely because dragging the ~100 KB gz Zod runtime into a
 * client component blew the 170 KB initial-JS budget on `/` and
 * `/watch/[campaignId]` (docs/13b section 8). The Zod schema for a currency
 * lives in `money-value.ts`, which is free to import this.
 *
 * ## Why this file exists at all
 *
 * The union `"AUD" | "IDR"` was written out by hand in three places —
 * `region.ts`'s `RegionConfig.currency`, `money-format.ts`'s
 * `SupportedCurrency`, and `money-format.ts`'s `CURRENCY_LOCALE` keys — with
 * a comment in each explaining that it could not import the others without
 * taking on Zod. Three hand-kept copies of a closed enum is the shape the
 * repo's own rule warns about: derive it, and if you genuinely cannot, guard
 * the copy with a drift test. This module makes deriving possible, so the
 * copies become imports rather than better-tested duplicates.
 *
 * Closed on purpose, like `regionSchema`. A third currency means a new PSP,
 * new tax rules and a new data plane (docs/15), not a config edit.
 */

/** ISO 4217 codes, in the order a listing renders them. */
export const CURRENCY_CODES = ["AUD", "IDR"] as const;

export type Currency = (typeof CURRENCY_CODES)[number];

/**
 * Narrows an unknown value to a `Currency`.
 *
 * A type predicate rather than a cast: `packages/contracts` bans `as`
 * assertions (`consistent-type-assertions: never`), and this is the reason
 * the ban is worth keeping — a currency arriving from JSON, a database row
 * or a driver's configuration is exactly the value you must not assert about.
 */
export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && CURRENCY_CODES.some((code) => code === value);
}
