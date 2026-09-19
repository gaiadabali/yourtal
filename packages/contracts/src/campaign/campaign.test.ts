import { describe, expect, it } from "vitest";
import { campaignSchema } from "./campaign";
import {
  generateCampaign,
  generateCampaigns,
  longMerchantNameCampaignFixture,
  mockCampaigns,
  zeroRewardCampaignFixture,
} from "./campaign.mock";

const validCampaign = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "long_form",
  title: "Cerita di Balik Kopi Kenangan",
  merchantId: "22222222-2222-4222-8222-222222222222",
  merchantName: "Kopi Kenangan",
  synopsis: "Kenali produk terbaru dari Kopi Kenangan.",
  durationSeconds: 600,
  estimatedDataMb: 210,
  rewardPoints: 2_400,
  questionCount: 3,
  scoringRule: "base_plus_accuracy_bonus",
  status: "active",
  publishedAt: "2026-09-01T00:00:00.000Z",
  chapters: [
    { title: "Chapter 1", startSeconds: 0, rewardWeight: 1 },
    { title: "Chapter 2", startSeconds: 200, rewardWeight: 1 },
    { title: "Chapter 3", startSeconds: 400, rewardWeight: 2 },
  ],
  videoSource: { kind: "hls", manifestUrl: "https://cdn.example.com/campaign.m3u8" },
};

describe("campaignSchema", () => {
  it("round-trips a valid campaign", () => {
    const parsed = campaignSchema.parse(validCampaign);
    expect(parsed).toMatchObject({ title: validCampaign.title, rewardPoints: 2_400 });
  });

  const rejectionTable: Array<{ name: string; overrides: Record<string, unknown> }> = [
    { name: "negative reward points", overrides: { rewardPoints: -100 } },
    { name: "non-integer reward points", overrides: { rewardPoints: 12.5 } },
    { name: "invalid kind enum value", overrides: { kind: "medium_form" } },
    { name: "invalid scoring rule enum value", overrides: { scoringRule: "random" } },
    { name: "invalid status enum value", overrides: { status: "archived" } },
    { name: "zero duration", overrides: { durationSeconds: 0 } },
    { name: "duration over the 3-hour ceiling", overrides: { durationSeconds: 20_000 } },
    { name: "negative question count", overrides: { questionCount: -1 } },
    { name: "non-uuid id", overrides: { id: "not-a-uuid" } },
    { name: "non-uuid merchantId", overrides: { merchantId: "not-a-uuid" } },
    { name: "empty merchant name", overrides: { merchantName: "" } },
    { name: "non-datetime publishedAt", overrides: { publishedAt: "yesterday" } },
    { name: "missing title", overrides: { title: undefined } },
    {
      name: "quick campaign longer than 60 seconds",
      overrides: { kind: "quick", durationSeconds: 300 },
    },
    {
      name: "accuracy bonus with zero questions",
      overrides: { scoringRule: "base_plus_accuracy_bonus", questionCount: 0 },
    },
    { name: "long_form campaign with no chapters", overrides: { chapters: [] } },
    {
      name: "quick campaign carrying chapters",
      overrides: {
        kind: "quick",
        durationSeconds: 30,
        chapters: [{ title: "Chapter 1", startSeconds: 0, rewardWeight: 1 }],
      },
    },
    {
      name: "first chapter not starting at 0",
      overrides: {
        chapters: [{ title: "Chapter 1", startSeconds: 5, rewardWeight: 1 }],
      },
    },
    {
      name: "chapter start times not strictly increasing",
      overrides: {
        chapters: [
          { title: "Chapter 1", startSeconds: 0, rewardWeight: 1 },
          { title: "Chapter 2", startSeconds: 0, rewardWeight: 1 },
        ],
      },
    },
    {
      name: "a chapter starting at or after durationSeconds",
      overrides: {
        chapters: [{ title: "Chapter 1", startSeconds: 600, rewardWeight: 1 }],
      },
    },
    {
      name: "invalid video source kind",
      overrides: { videoSource: { kind: "mp4", url: "https://cdn.example.com/campaign.mp4" } },
    },
  ];

  it.each(rejectionTable)("rejects $name", ({ overrides }) => {
    const candidate = { ...validCampaign, ...overrides };
    expect(campaignSchema.safeParse(candidate).success).toBe(false);
  });
});

describe("generateCampaign determinism", () => {
  it("produces byte-identical output for the same seed and reference instant", () => {
    const now = new Date("2026-09-19T09:00:00.000Z");
    const first = generateCampaign({ seed: 42, now });
    const second = generateCampaign({ seed: 42, now });
    expect(first).toStrictEqual(second);
  });

  it("produces different output for a different seed", () => {
    const now = new Date("2026-09-19T09:00:00.000Z");
    const first = generateCampaign({ seed: 42, now });
    const second = generateCampaign({ seed: 43, now });
    expect(first).not.toStrictEqual(second);
  });

  it("generates a batch that is itself deterministic", () => {
    const first = generateCampaigns(24, 1_000);
    const second = generateCampaigns(24, 1_000);
    expect(first).toStrictEqual(second);
    expect(first).toStrictEqual(mockCampaigns);
  });
});

describe("awkward fixtures", () => {
  it("the zero-reward campaign fixture pays exactly zero points and is a valid campaign", () => {
    expect(zeroRewardCampaignFixture.rewardPoints).toBe(0);
    expect(campaignSchema.safeParse(zeroRewardCampaignFixture).success).toBe(true);
  });

  it("the long-merchant-name campaign fixture exceeds 40 characters", () => {
    expect(longMerchantNameCampaignFixture.merchantName.length).toBeGreaterThan(40);
  });
});
