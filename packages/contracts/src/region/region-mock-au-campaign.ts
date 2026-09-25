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
import { MOCK_HLS_MANIFEST_URL } from "../campaign/campaign.mock";
import type { Audience } from "../audience/audience";
import type { ContentCategory } from "@yourtal/jurisdiction/content-category";

const MOCK_MEDIA_ORIGIN = "http://127.0.0.1:26900/yourtal-media";

const MOCK_CONTENT_CATEGORIES: readonly ContentCategory[] = [
  "food-and-drink",
  "fashion",
  "personal-care",
  "electronics",
  "telco",
  "transport",
  "fitness",
  "education",
  "travel",
  "home",
  "entertainment",
  "games",
  "books",
  "family",
  "toys",
  "digital-goods",
  "services",
];

const MOCK_AUDIENCES: readonly { value: Audience; weight: number }[] = [
  { value: "all_ages", weight: 6 },
  { value: "adult", weight: 2 },
  { value: "parents", weight: 1 },
];

/**
 * AU counterpart to `campaign.mock.ts` — see `region-mock-au-listing.ts`'s
 * header for why this used to live in one `region-mock-au.ts` file.
 */

const MOCK_VIDEO_SOURCE: CampaignVideoSource = {
  kind: "hls",
  // Imported rather than repeated: this file used to carry its own copy of
  // the manifest URL, so repointing the player at the local origin meant
  // finding both. One of them would eventually have been missed.
  manifestUrl: MOCK_HLS_MANIFEST_URL,
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
  // Capped at 5, not 6 — see campaign.mock.ts's generateCampaign for why (F10).
  const questionCount =
    kind === "quick" ? faker.number.int({ min: 0, max: 2 }) : faker.number.int({ min: 1, max: 5 });
  const scoringRule =
    questionCount > 0 && faker.datatype.boolean({ probability: 0.7 })
      ? "base_plus_accuracy_bonus"
      : "base_only";
  const publishedAt = addDays(now, -faker.number.int({ min: 0, max: 30 }));
  const estimatedDataMb = Math.round(durationSeconds * 0.35 * 10) / 10;

  return campaignSchema.parse({
    id: faker.string.uuid(),
    kind,
    title: generateCampaignTitleAu(faker, merchantName),
    merchantId: merchant.id,
    merchantName,
    synopsis: generateCampaignSynopsisAu(faker, merchantName),
    durationSeconds,
    estimatedDataMb,
    rewardPoints: toPoints(
      faker.number.int({ min: kind === "quick" ? 50 : 500, max: kind === "quick" ? 400 : 4_000 }),
    ),
    questionCount,
    scoringRule,
    status: "active",
    publishedAt: toIsoString(publishedAt),
    chapters: kind === "long_form" ? auChapters(durationSeconds) : [],
    videoSource: MOCK_VIDEO_SOURCE,
    businessId: merchant.id,
    region: merchant.region,
    audience: faker.helpers.weightedArrayElement(MOCK_AUDIENCES),
    contentCategory: faker.helpers.arrayElement(MOCK_CONTENT_CATEGORIES),
    posterUrl: `${MOCK_MEDIA_ORIGIN}/posters/${faker.string.uuid()}.jpg`,
    teaserUrl: `${MOCK_MEDIA_ORIGIN}/teasers/${faker.string.uuid()}.mp4`,
    hlsUrl: MOCK_VIDEO_SOURCE.manifestUrl,
    captionsUrl: null,
    aspect: kind === "quick" ? "9:16" : "16:9",
    estimatedBytes: Math.round(estimatedDataMb * 1024 * 1024),
    startsAt: toIsoString(publishedAt),
    endsAt: toIsoString(addDays(publishedAt, 90)),
    openViewing: false,
    teaserStartSeconds: 0,
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
  businessId: "00000000-0000-4000-8000-0000000006a2",
  region: "AU",
  audience: "all_ages",
  contentCategory: "food-and-drink",
  posterUrl: `${MOCK_MEDIA_ORIGIN}/posters/00000000-0000-4000-8000-0000000001a2.jpg`,
  teaserUrl: `${MOCK_MEDIA_ORIGIN}/teasers/00000000-0000-4000-8000-0000000001a2.mp4`,
  hlsUrl: MOCK_VIDEO_SOURCE.manifestUrl,
  captionsUrl: null,
  aspect: "9:16",
  estimatedBytes: Math.round(12 * 1024 * 1024),
  startsAt: toIsoString(DEFAULT_REFERENCE_INSTANT),
  endsAt: toIsoString(addDays(DEFAULT_REFERENCE_INSTANT, 90)),
  openViewing: false,
  teaserStartSeconds: 0,
});
