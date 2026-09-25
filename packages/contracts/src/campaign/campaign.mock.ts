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
import type { Audience } from "../audience/audience";
import type { ContentCategory } from "@yourtal/jurisdiction/content-category";

/**
 * The "ordinary" (never adult_only/prohibited anywhere) categories, for a
 * generator that has no reason to pick a regulated one — TASKS.md 1.1.a/d.
 */
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

/** Skewed toward the common case; TEEN_ACCOUNTS is off everywhere today (1.1.c), so this never picks "teen". */
const MOCK_AUDIENCES: readonly { value: Audience; weight: number }[] = [
  { value: "all_ages", weight: 6 },
  { value: "adult", weight: 2 },
  { value: "parents", weight: 1 },
];

/**
 * The local HLS origin (YT-0521), which every mock campaign now plays.
 *
 * ## What this replaced, and why the replacement had to be a ladder
 *
 * It was Apple's `bipbop_16x9_variant.m3u8`, a publicly hosted reference
 * stream. It was chosen over an arbitrary single-bitrate file because it ships
 * a genuine ABR ladder, so the quality selector has real levels to switch
 * between. (That rationale used to live in
 * `apps/web/features/player/video-source.ts`, deleted in `9bd450d`; it is
 * restated here rather than pointed at, so it cannot be orphaned twice.) Any
 * replacement had to keep that property or it would have fixed one
 * untestable feature by breaking another — so `packages/media`'s fixture is
 * three renditions with a master playlist, not one stream.
 *
 * ## Why it closes YT-0412 as well as YT-0526
 *
 * YT-0412's keyboard-seeking criterion was **untestable, not failing**: the
 * Apple stream's 59 MB segment aborted before the video element reported a
 * duration, and a seek cannot be asserted against a video with no duration.
 * The fixture is five 4-second segments totalling 20 seconds.
 *
 * ## Why this is a literal rather than an import
 *
 * `packages/contracts` sits upstream of everything and must not depend on
 * `packages/media`. So the URL is spelled out here and
 * `hls-fixture-url.test.ts` asserts it still matches what the media package
 * actually serves — a guarded copy rather than an unguarded one, which is
 * the same trade the OpenAPI document and the region mirror already make.
 *
 * It is a loopback URL because it is mock data for the local stack. Real
 * campaigns will carry their own per-encode URL through this same field.
 */
export const MOCK_HLS_MANIFEST_URL =
  "http://127.0.0.1:26900/yourtal-media/hls/attention-30s/index.m3u8";

const MOCK_VIDEO_SOURCE: CampaignVideoSource = { kind: "hls", manifestUrl: MOCK_HLS_MANIFEST_URL };

/**
 * Same local MinIO origin as `MOCK_HLS_MANIFEST_URL` above, for the poster
 * and teaser fields TASKS.md 1.1.a adds. No file is guaranteed to exist at
 * these paths yet — publishing real posters and teaser clips is 3.2/5.1's
 * job — this only needs to be a well-formed URL for `campaignSchema` today.
 */
const MOCK_MEDIA_ORIGIN = "http://127.0.0.1:26900/yourtal-media";

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
  // Capped at 5, not 6: F10 (question-bank.ts's questionsAskedFor) never
  // asks more than MAX_QUESTIONS_ASKED, and campaignSchema.questionCount now
  // enforces the same ceiling (TASKS.md 1.1.f).
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
    title: generateCampaignTitle(faker, merchantName),
    merchantId: merchant.id,
    merchantName,
    synopsis: generateCampaignSynopsis(faker, merchantName),
    durationSeconds,
    estimatedDataMb,
    rewardPoints: toPoints(
      faker.number.int({ min: kind === "quick" ? 50 : 500, max: kind === "quick" ? 400 : 4_000 }),
    ),
    questionCount,
    scoringRule,
    status: "active",
    publishedAt: toIsoString(publishedAt),
    chapters: kind === "long_form" ? mockChapters(durationSeconds) : [],
    videoSource: MOCK_VIDEO_SOURCE,
    // A business account roster does not exist separately from the merchant
    // roster yet (TASKS.md 1.1's scope is the shape, not that reconciliation)
    // — a merchant's own id stands in as its business id until one does.
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
  businessId: "00000000-0000-4000-8000-000000000606",
  region: "ID",
  audience: "all_ages",
  contentCategory: "entertainment",
  posterUrl: `${MOCK_MEDIA_ORIGIN}/posters/00000000-0000-4000-8000-000000000001.jpg`,
  teaserUrl: `${MOCK_MEDIA_ORIGIN}/teasers/00000000-0000-4000-8000-000000000001.mp4`,
  hlsUrl: MOCK_VIDEO_SOURCE.manifestUrl,
  captionsUrl: null,
  aspect: "16:9",
  estimatedBytes: Math.round(210 * 1024 * 1024),
  startsAt: toIsoString(DEFAULT_REFERENCE_INSTANT),
  endsAt: toIsoString(addDays(DEFAULT_REFERENCE_INSTANT, 90)),
  openViewing: false,
  teaserStartSeconds: 0,
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
  businessId: "00000000-0000-4000-8000-000000000606",
  region: "ID",
  audience: "all_ages",
  contentCategory: "food-and-drink",
  posterUrl: `${MOCK_MEDIA_ORIGIN}/posters/00000000-0000-4000-8000-000000000002.jpg`,
  teaserUrl: `${MOCK_MEDIA_ORIGIN}/teasers/00000000-0000-4000-8000-000000000002.mp4`,
  hlsUrl: MOCK_VIDEO_SOURCE.manifestUrl,
  captionsUrl: null,
  aspect: "9:16",
  estimatedBytes: Math.round(12 * 1024 * 1024),
  startsAt: toIsoString(DEFAULT_REFERENCE_INSTANT),
  endsAt: toIsoString(addDays(DEFAULT_REFERENCE_INSTANT, 90)),
  openViewing: false,
  teaserStartSeconds: 0,
});

export const mockCampaigns: Campaign[] = generateCampaigns(24, 1_000);
