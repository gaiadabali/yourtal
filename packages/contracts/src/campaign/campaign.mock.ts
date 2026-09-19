import type { Campaign } from "./campaign";
import { campaignSchema } from "./campaign";
import type { CampaignChapter } from "./campaign-chapter";
import type { CampaignVideoSource } from "./campaign-video-source";
import { DEFAULT_REFERENCE_INSTANT, addDays, toIsoString } from "../internal/clock";
import { createSeededFaker } from "../internal/seeded-faker";
import {
  LONG_MERCHANT_NAME,
  generateCampaignSynopsis,
  generateCampaignTitle,
} from "../internal/jakarta";
import { toPoints } from "../money/money";
import { pickMockMerchant } from "../merchant/merchant-roster";

/**
 * The same publicly hosted, real multi-bitrate HLS stream apps/web's
 * `video-source.ts` mock points every campaign at today — chosen there
 * deliberately over an arbitrary single-bitrate file because it ships a
 * genuine ABR ladder. Reused verbatim here so the eventual switch (deleting
 * that local fake in favour of this field) changes nothing about what plays.
 */
const MOCK_HLS_MANIFEST_URL =
  "https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8";

const MOCK_VIDEO_SOURCE: CampaignVideoSource = { kind: "hls", manifestUrl: MOCK_HLS_MANIFEST_URL };

/**
 * Back-loaded chapter weights reproducing docs/06 section 3's own worked
 * example verbatim (a 2,000-point campaign split `[1,1,1,2,5]` yields
 * `200,200,200,400,1000` — the first three comfortably less than the last).
 * Boundaries are spread evenly across the campaign's duration; only the
 * weights carry the back-loading.
 */
const CHAPTER_WEIGHTS: readonly number[] = [1, 1, 1, 2, 5];

function mockChapters(durationSeconds: number): CampaignChapter[] {
  const count = CHAPTER_WEIGHTS.length;
  const chapterSeconds = Math.floor(durationSeconds / count);
  return CHAPTER_WEIGHTS.map((rewardWeight, index) => ({
    title: `Chapter ${String(index + 1)}`,
    startSeconds: index * chapterSeconds,
    rewardWeight,
  }));
}

export interface GenerateCampaignParams {
  seed: number;
  now?: Date | undefined;
}

/** Generates one deterministic, realistic campaign for the given seed. */
export function generateCampaign(params: GenerateCampaignParams): Campaign {
  const now = params.now ?? DEFAULT_REFERENCE_INSTANT;
  const faker = createSeededFaker(params.seed);

  const kind = faker.helpers.arrayElement(["long_form", "quick"] as const);
  // Merchant identity comes from the shared roster, never from the faker.
  // A random per-fixture uuid here is what made every prototype redemption
  // return `wrong_merchant`: the counter can only be provisioned as a roster
  // merchant, so a generated one could never match. See merchant-roster.ts.
  const merchant = pickMockMerchant(faker, "ID");
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
    title: generateCampaignTitle(faker, merchantName),
    merchantId: merchant.id,
    merchantName,
    synopsis: generateCampaignSynopsis(faker, merchantName),
    durationSeconds,
    estimatedDataMb: Math.round(durationSeconds * 0.35 * 10) / 10,
    rewardPoints: toPoints(
      faker.number.int({ min: kind === "quick" ? 50 : 500, max: kind === "quick" ? 400 : 4_000 }),
    ),
    questionCount,
    scoringRule,
    status: "active",
    publishedAt: toIsoString(addDays(now, -faker.number.int({ min: 0, max: 30 }))),
    chapters: kind === "long_form" ? mockChapters(durationSeconds) : [],
    videoSource: MOCK_VIDEO_SOURCE,
  });
}

/** Generates `count` deterministic campaigns from a base seed. */
export function generateCampaigns(count: number, baseSeed: number, now?: Date): Campaign[] {
  return Array.from({ length: count }, (_unused, index) =>
    generateCampaign({ seed: baseSeed + index, now }),
  );
}

/** A campaign that pays zero points — an awkward, legitimate edge case (a pure-reach opt-in). */
export const zeroRewardCampaignFixture: Campaign = campaignSchema.parse({
  id: "00000000-0000-4000-8000-000000000001",
  kind: "long_form",
  title: "Perkenalan Layanan Baru",
  merchantId: "00000000-0000-4000-8000-000000000606",
  merchantName: LONG_MERCHANT_NAME,
  synopsis: "Video pengantar tanpa reward, digunakan untuk menguji tampilan reward nol.",
  durationSeconds: 600,
  estimatedDataMb: 210,
  rewardPoints: toPoints(0),
  questionCount: 3,
  scoringRule: "base_only",
  status: "active",
  publishedAt: toIsoString(DEFAULT_REFERENCE_INSTANT),
  chapters: mockChapters(600),
  videoSource: MOCK_VIDEO_SOURCE,
});

/** A quick campaign with the long merchant-name fixture, for 320px-viewport checks. */
export const longMerchantNameCampaignFixture: Campaign = campaignSchema.parse({
  id: "00000000-0000-4000-8000-000000000002",
  kind: "quick",
  title: "Promo Kilat",
  merchantId: "00000000-0000-4000-8000-000000000606",
  merchantName: LONG_MERCHANT_NAME,
  synopsis: "Campaign singkat dari merchant dengan nama sangat panjang.",
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

export const mockCampaigns: Campaign[] = generateCampaigns(24, 1_000);
