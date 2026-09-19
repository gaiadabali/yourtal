/**
 * Ids of the real, live-catalogue mock fixtures this suite drives, kept in
 * one place so a spec never hand-copies a UUID it can't explain.
 *
 * These are not test-only stubs — they are the exact fixtures exported by
 * `@yourtal/contracts` (`packages/contracts/src/campaign/campaign.mock.ts`,
 * `.../listing/listing.mock.ts`) and wired into the app's own mock data
 * layer (`features/campaign/campaign-data.ts`, `features/store/store-data.ts`,
 * `features/player/get-watch-campaign.ts`). Routing at these ids exercises
 * the real catalogue lookup path, not a synthesized fallback.
 */

/** `longMerchantNameCampaignFixture` — a `quick` campaign, 78-char merchant name. */
export const LONG_MERCHANT_CAMPAIGN_ID = "00000000-0000-4000-8000-000000000002";

/**
 * `zeroRewardCampaignFixture` — a `long_form` campaign (600s, 3 questions),
 * also carrying the long merchant name. Used for `/watch` and `/watch/.../checkpoint`,
 * whose player and quiz UI only make sense for the long-form kind.
 */
export const LONG_FORM_CAMPAIGN_ID = "00000000-0000-4000-8000-000000000001";

/** `abovePlausibleBalanceListingFixture` — a `Listing`, also carrying the long merchant name. */
export const LONG_MERCHANT_LISTING_ID = "00000000-0000-4000-8000-000000000202";

/**
 * One of the 24 generated `mockCampaigns` (seed 1000): `kind: "long_form"`,
 * `scoringRule: "base_plus_accuracy_bonus"`. Found by browsing
 * `/?kind=long_form` and checking each `/campaign/[id]` for a rendered
 * "Bonus akurasi" row — deterministic across builds because the generator
 * seed is fixed, but not a fixture with its own exported name the way the
 * ones above are. Needed because `LONG_FORM_CAMPAIGN_ID` above
 * (`zeroRewardCampaignFixture`) is `scoringRule: "base_only"` and can never
 * demonstrate the checkpoint result screen's base-vs-bonus distinction
 * (YT-0450's first acceptance criterion for the Earn journey).
 */
export const BONUS_ACCURACY_CAMPAIGN_ID = "39916ad7-b0e8-4b72-b5a4-33da5cf9336c";

/**
 * One of the 30 generated `mockListings` (seed 2000): affordable against
 * `mixedStateBalanceFixture`'s 8,400 available points (unlike
 * `LONG_MERCHANT_LISTING_ID` above, which is deliberately priced out of
 * reach). Found by browsing `/store` and checking each `/store/[id]` for a
 * rendered "Tukar Sekarang" (enabled redeem) button rather than "Poin belum
 * cukup". Deterministic across builds for the same reason as
 * `BONUS_ACCURACY_CAMPAIGN_ID` above.
 */
export const AFFORDABLE_LISTING_ID = "0c9fa973-ab41-4f44-9cc8-664b37e4cc63";

/**
 * One of the 15 generated `mockVouchers` (seed 3000, from
 * `@yourtal/contracts/voucher/mock`) — genuinely visible on `/wallet`
 * (unlike the merchant-only fixtures in
 * `features/merchant/merchant-voucher-fixtures.ts`), `status: "active"`,
 * expiring 2026-11-04 (far past this suite's run date, unlike
 * `expiringWithinHourVoucherFixture`, which this suite tried first — that
 * fixture's `expiresAt` is 45 minutes past a FIXED reference instant, so
 * depending on wall-clock time on the day this suite actually runs it may
 * already have expired, which is exactly what happened while writing this:
 * it rendered "Kedaluwarsa" instead of an active QR).
 *
 * Used by the Redeem journey to prove — or disprove — that a voucher a
 * real customer can actually see in their own Wallet can be redeemed at a
 * real, provisionable counter device. See `redeem-journey.spec.ts`'s top
 * comment for why this id's `merchantId` (a random per-fixture UUID, like
 * every generated mock voucher's) does NOT match any of
 * `provisioning-data.ts`'s three provisionable merchant ids.
 */
export const WALLET_VOUCHER_ID = "288791d1-5ed5-46aa-978e-fe1abc81fb24";
export const WALLET_VOUCHER_CODE = "A4JLOFVI39";

/**
 * `healthyVoucherFixture` (`features/merchant/merchant-voucher-fixtures.ts`)
 * — merchant-only, NOT reachable from `/wallet` (see that file's own doc
 * comment on why it exists only in the counter device's catalogue). Its
 * `merchantId` genuinely matches the "TOKO-BERKAH-1" provisioning code
 * below, so it is the only way to exercise a real, matching-merchant
 * success outcome at the counter in this environment.
 */
export const MERCHANT_ONLY_VOUCHER_CODE = "GOODCODE1";

/** Resolves to `merchantId` `00000000-0000-4000-8000-000000000601` ("Toko Berkah") in `provisioning-data.ts`. */
export const MERCHANT_PROVISIONING_CODE = "TOKO-BERKAH-1";
export const MERCHANT_PROVISIONING_PIN = "1234";
