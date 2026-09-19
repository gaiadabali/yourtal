import type { Campaign, CampaignStatus } from "@yourtal/contracts/campaign";
import { campaignSchema } from "@yourtal/contracts/campaign";
import { generateCampaign } from "@yourtal/contracts/campaign/mock";
import type { Listing } from "@yourtal/contracts/listing";
import { listingSchema } from "@yourtal/contracts/listing";
import { generateListing } from "@yourtal/contracts/listing/mock";
import type { Question } from "@yourtal/contracts/question";
import { generateQuestions } from "@yourtal/contracts/question/mock";
import type { Voucher, VoucherStatus } from "@yourtal/contracts/voucher";
import { voucherSchema } from "@yourtal/contracts/voucher";
import { generateVoucher } from "@yourtal/contracts/voucher/mock";

/**
 * Server-data-only mock fixtures for the business Reports zone (YT-0443),
 * same idiom as `console-fixtures.ts` and the same reason it exists:
 * `packages/contracts`'s generic generators (`generateCampaign`,
 * `generateListing`, `generateVoucher`) assign each row a fresh random
 * `merchantId`, which is correct for a generic catalogue and useless for a
 * business console screen that needs to show ONE business's own
 * campaigns, listings and vouchers. `console-fixtures.ts` hit the exact
 * same problem for team rosters and hand-built the roster instead — this
 * file does the equivalent thing here, still going through the real Zod
 * schemas (`campaignSchema.parse` etc.), never hand-shaping an object the
 * contract would reject.
 *
 * Only `reports-data.ts` imports this module — it value-imports Zod
 * schemas and mock generators, which is correct at this server-only data
 * boundary and would blow the client bundle budget anywhere else
 * (docs/13b-typescript-standards.md §8).
 */

/** Deterministic small integer seed from a UUID string, so each business gets stable-but-different fixtures without needing `packages/contracts`'s unexported `createSeededFaker`. */
function seedFromId(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export interface ReportsFixtureScope {
  businessId: string;
  businessDisplayName: string;
}

const CAMPAIGN_STATUS_CYCLE: readonly CampaignStatus[] = ["active", "active", "paused", "ended"];

/** This business's own campaigns — the fixture stand-in for "campaigns this advertiser has run." */
export function buildCampaignFixtures({
  businessId,
  businessDisplayName,
}: ReportsFixtureScope): Campaign[] {
  const baseSeed = seedFromId(businessId);
  return CAMPAIGN_STATUS_CYCLE.map((status, index) => {
    const generated = generateCampaign({ seed: baseSeed + index * 7 });
    return campaignSchema.parse({
      ...generated,
      merchantId: businessId,
      merchantName: businessDisplayName,
      status,
    });
  });
}

/** The question bank actually configured for one campaign — `generateQuestions` already accepts a `campaignId` to scope to, no override needed. */
export function buildQuestionFixtures(campaign: Campaign): Question[] {
  if (campaign.questionCount === 0) {
    return [];
  }
  return generateQuestions(campaign.questionCount, seedFromId(campaign.id), campaign.id);
}

const LISTING_COUNT = 3;

/** This business's own store listings — the fixture stand-in for "inventory this supplier has published." */
export function buildListingFixtures({
  businessId,
  businessDisplayName,
}: ReportsFixtureScope): Listing[] {
  const baseSeed = seedFromId(businessId) + 1_000;
  return Array.from({ length: LISTING_COUNT }, (_unused, index) => {
    const generated = generateListing({ seed: baseSeed + index });
    return listingSchema.parse({
      ...generated,
      merchantId: businessId,
      merchantName: businessDisplayName,
      title: `Voucher ${businessDisplayName}`,
    });
  });
}

/**
 * A realistic spread across every `VoucherStatus`, weighted toward
 * `redeemed` — this is the ledger the redemption panel summarises, so it
 * needs more than one row per status to be worth looking at.
 */
const VOUCHER_STATUS_CYCLE: readonly VoucherStatus[] = [
  "redeemed",
  "redeemed",
  "redeemed",
  "active",
  "active",
  "expired",
  "transferred",
];

export interface BuildVoucherFixturesParams extends ReportsFixtureScope {
  listings: readonly Listing[];
}

/**
 * Vouchers issued against this business's own listings. Each voucher's
 * `merchantId` is set to this business — the field voucherSchema documents
 * as "the identity a redemption is authorized against" — so these are
 * genuinely this business's redemption ledger, not an arbitrary sample.
 */
export function buildVoucherFixtures({
  businessId,
  businessDisplayName,
  listings,
}: BuildVoucherFixturesParams): Voucher[] {
  if (listings.length === 0) {
    throw new Error("buildVoucherFixtures requires at least one listing to attach vouchers to");
  }
  const baseSeed = seedFromId(businessId) + 2_000;
  return VOUCHER_STATUS_CYCLE.map((status, index) => {
    const listing = listings[index % listings.length];
    if (!listing) {
      throw new Error("unreachable: index modulo listings.length is always a valid index");
    }
    const generated = generateVoucher({ seed: baseSeed + index });
    return voucherSchema.parse({
      ...generated,
      listingId: listing.id,
      merchantId: businessId,
      merchantName: businessDisplayName,
      status,
    });
  });
}
