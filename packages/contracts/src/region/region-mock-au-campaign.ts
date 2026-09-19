import type { Campaign } from "../campaign/campaign";
import { campaignSchema } from "../campaign/campaign";
import type { CampaignChapter } from "../campaign/campaign-chapter";
import type { CampaignVideoSource } from "../campaign/campaign-video-source";
import { DEFAULT_REFERENCE_INSTANT, addDays, toIsoString } from "../internal/clock";
import { createSeededFaker } from "../internal/seeded-faker";
import {
  LONG_MERCHANT_NAME_AU,
  generateCampaignSynopsisAu,
  generateCampaignTitleAu,
} from "../internal/sydney";
import { toPoints } from "../money/money";
import { pickMockMerchant } from "../merchant/merchant-roster";

/**
 * AU counterpart to `campaign.mock.ts` — see `region-mock-au-listing.ts`'s
 * header for why this used to live in one `region-mock-au.ts` file.
 */

const MOCK_VIDEO_SOURCE: CampaignVideoSource = {
  kind: "hls",
  manifestUrl:
    "https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8",
};

// Same back-loaded shape as campaign.mock.ts's mockChapters — see docs/06
// section 3's worked example, which this reproduces.
const CHAPTER_WEIGHTS: readonly number[] = [1, 1, 1, 2, 5];

function auChapters(durationSeconds: number): CampaignChapter[] {
  const chapterSeconds = Math.floor(durationSeconds / CHAPTER_WEIGHTS.length);
  return CHAPTER_WEIGHTS.map((rewardWeight, index) => ({
    title: `Chapter ${String(index + 1)}`,
    startSeconds: index * chapterSeconds,
    rewardWeight,
  }));
}

function auCampaignFrom(faker: ReturnType<typeof createSeededFaker>, now: Date): Campaign {
  const kind = faker.helpers.arrayElement(["long_form", "quick"] as const);
  // Merchant identity comes from the shared roster, never from the faker.
  // A random per-fixture uuid here is what made every prototype redemption
  // return `wrong_merchant`: the counter can only be provisioned as a roster
  // merchant, so a generated one could never match. See merchant-roster.ts.
  const merchant = pickMockMerchant(faker, "AU");
  const merchantName = merchant.name;
  const durationSeconds =
    kind === "quick"
      ? faker.number.int({ min: 15, max: 60 })
      : faker.number.int({ min: 300, max: 1_800 });
  const questionCount =
    kind === "quick" ? faker.number.int({ min: 0, max: 2 }) : faker.number.int({ min: 1, max: 6 });
  const scoringRule =
    questionCount > 0 && faker.datatype.boolean({ probability: 0.7 })
      ? "base_plus_accuracy_bonus"
      : "base_only";

  return campaignSchema.parse({
    id: faker.string.uuid(),
    kind,
    title: generateCampaignTitleAu(faker, merchantName),
    merchantId: merchant.id,
    merchantName,
    synopsis: generateCampaignSynopsisAu(faker, merchantName),
    durationSeconds,
    estimatedDataMb: Math.round(durationSeconds * 0.35 * 10) / 10,
    rewardPoints: toPoints(
      faker.number.int({ min: kind === "quick" ? 50 : 500, max: kind === "quick" ? 400 : 4_000 }),
    ),
    questionCount,
    scoringRule,
    status: "active",
    publishedAt: toIsoString(addDays(now, -faker.number.int({ min: 0, max: 30 }))),
    chapters: kind === "long_form" ? auChapters(durationSeconds) : [],
    videoSource: MOCK_VIDEO_SOURCE,
  });
}

/** Generates `count` deterministic AU campaigns from a base seed. */
export function generateAuCampaigns(count: number, baseSeed: number, now?: Date): Campaign[] {
  const reference = now ?? DEFAULT_REFERENCE_INSTANT;
  return Array.from({ length: count }, (_unused, index) =>
    auCampaignFrom(createSeededFaker(baseSeed + index), reference),
  );
}

/** The AU "long merchant name" campaign fixture. */
export const auLongMerchantNameCampaignFixture: Campaign = campaignSchema.parse({
  id: "00000000-0000-4000-8000-0000000001a2",
  kind: "quick",
  title: "Flash Promo",
  merchantId: "00000000-0000-4000-8000-0000000006a2",
  merchantName: LONG_MERCHANT_NAME_AU,
  synopsis: "A short campaign from a merchant with a very long name.",
  durationSeconds: 30,
  estimatedDataMb: 12,
  rewardPoints: toPoints(150),
  questionCount: 0,
  scoringRule: "base_only",
  status: "active",
  publishedAt: toIsoString(DEFAULT_REFERENCE_INSTANT),
  chapters: [],
  videoSource: MOCK_VIDEO_SOURCE,
});
