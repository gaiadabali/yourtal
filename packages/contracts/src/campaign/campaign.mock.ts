import type { Campaign } from "./campaign";
import { campaignSchema } from "./campaign";
import { DEFAULT_REFERENCE_INSTANT, addDays, toIsoString } from "../internal/clock";
import { createSeededFaker } from "../internal/seeded-faker";
import { LONG_MERCHANT_NAME, generateCampaignSynopsis, generateCampaignTitle, generateMerchantName } from "../internal/jakarta";
import { toPoints } from "../money/money";

export interface GenerateCampaignParams {
  seed: number;
  now?: Date | undefined;
}

/** Generates one deterministic, realistic campaign for the given seed. */
export function generateCampaign(params: GenerateCampaignParams): Campaign {
  const now = params.now ?? DEFAULT_REFERENCE_INSTANT;
  const faker = createSeededFaker(params.seed);

  const kind = faker.helpers.arrayElement(["long_form", "quick"] as const);
  const merchantName = generateMerchantName(faker);
  const durationSeconds = kind === "quick" ? faker.number.int({ min: 15, max: 60 }) : faker.number.int({ min: 300, max: 1_800 });
  const questionCount = kind === "quick" ? faker.number.int({ min: 0, max: 2 }) : faker.number.int({ min: 1, max: 6 });
  const scoringRule = questionCount > 0 && faker.datatype.boolean({ probability: 0.7 }) ? "base_plus_accuracy_bonus" : "base_only";

  return campaignSchema.parse({
    id: faker.string.uuid(),
    kind,
    title: generateCampaignTitle(faker, merchantName),
    merchantId: faker.string.uuid(),
    merchantName,
    synopsis: generateCampaignSynopsis(faker, merchantName),
    durationSeconds,
    estimatedDataMb: Math.round(durationSeconds * 0.35 * 10) / 10,
    rewardPoints: toPoints(faker.number.int({ min: kind === "quick" ? 50 : 500, max: kind === "quick" ? 400 : 4_000 })),
    questionCount,
    scoringRule,
    status: "active",
    publishedAt: toIsoString(addDays(now, -faker.number.int({ min: 0, max: 30 }))),
  });
}

/** Generates `count` deterministic campaigns from a base seed. */
export function generateCampaigns(count: number, baseSeed: number, now?: Date): Campaign[] {
  return Array.from({ length: count }, (_unused, index) => generateCampaign({ seed: baseSeed + index, now }));
}

/** A campaign that pays zero points — an awkward, legitimate edge case (a pure-reach opt-in). */
export const zeroRewardCampaignFixture: Campaign = campaignSchema.parse({
  id: "00000000-0000-4000-8000-000000000001",
  kind: "long_form",
  title: "Perkenalan Layanan Baru",
  merchantId: "00000000-0000-4000-8000-000000000101",
  merchantName: LONG_MERCHANT_NAME,
  synopsis: "Video pengantar tanpa reward, digunakan untuk menguji tampilan reward nol.",
  durationSeconds: 600,
  estimatedDataMb: 210,
  rewardPoints: toPoints(0),
  questionCount: 3,
  scoringRule: "base_only",
  status: "active",
  publishedAt: toIsoString(DEFAULT_REFERENCE_INSTANT),
});

/** A quick campaign with the long merchant-name fixture, for 320px-viewport checks. */
export const longMerchantNameCampaignFixture: Campaign = campaignSchema.parse({
  id: "00000000-0000-4000-8000-000000000002",
  kind: "quick",
  title: "Promo Kilat",
  merchantId: "00000000-0000-4000-8000-000000000102",
  merchantName: LONG_MERCHANT_NAME,
  synopsis: "Campaign singkat dari merchant dengan nama sangat panjang.",
  durationSeconds: 30,
  estimatedDataMb: 12,
  rewardPoints: toPoints(150),
  questionCount: 0,
  scoringRule: "base_only",
  status: "active",
  publishedAt: toIsoString(DEFAULT_REFERENCE_INSTANT),
});

export const mockCampaigns: Campaign[] = generateCampaigns(24, 1_000);
