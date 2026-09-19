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
