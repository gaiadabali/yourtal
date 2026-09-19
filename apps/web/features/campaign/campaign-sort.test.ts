import { describe, expect, it } from "vitest";
import type { Campaign } from "@yourtal/contracts/campaign";
import { zeroRewardCampaignFixture } from "@yourtal/contracts/campaign/mock";
import { toPoints } from "@yourtal/contracts/money";
import {
  campaignSortKeys,
  expectedValuePerMinute,
  isCampaignSortKey,
  sortCampaigns,
} from "./campaign-sort";

const short: Campaign = {
  ...zeroRewardCampaignFixture,
  id: "11111111-1111-4111-8111-111111111111",
  durationSeconds: 300,
  rewardPoints: toPoints(3_000),
  publishedAt: "2026-09-01T00:00:00.000Z",
};
const long: Campaign = {
  ...zeroRewardCampaignFixture,
  id: "22222222-2222-4222-8222-222222222222",
  durationSeconds: 1_800,
  rewardPoints: toPoints(3_600),
  publishedAt: "2026-09-10T00:00:00.000Z",
};

describe("expectedValuePerMinute", () => {
  it("rewards a short, well-paid campaign with a higher score than a long one paying similarly", () => {
    expect(expectedValuePerMinute(short)).toBeGreaterThan(expectedValuePerMinute(long));
  });

  it("returns 0 rather than dividing by zero for a zero-duration edge case", () => {
    expect(expectedValuePerMinute({ ...short, durationSeconds: 0 })).toBe(0);
  });
});

describe("sortCampaigns", () => {
  it("does not mutate the input array", () => {
    const input = [long, short];
    const copy = [...input];
    sortCampaigns(input, "reward");
    expect(input).toEqual(copy);
  });

  it("sorts by value (points per minute) descending by default", () => {
    expect(sortCampaigns([long, short], "value").map((c) => c.id)).toEqual([short.id, long.id]);
  });

  it("sorts by reward descending", () => {
    expect(sortCampaigns([short, long], "reward").map((c) => c.id)).toEqual([long.id, short.id]);
  });

  it("sorts by duration ascending (shortest first)", () => {
    expect(sortCampaigns([long, short], "duration").map((c) => c.id)).toEqual([short.id, long.id]);
  });

  it("sorts by newest publishedAt first", () => {
    expect(sortCampaigns([short, long], "newest").map((c) => c.id)).toEqual([long.id, short.id]);
  });
});

describe("isCampaignSortKey", () => {
  it("accepts every declared sort key", () => {
    for (const key of campaignSortKeys) {
      expect(isCampaignSortKey(key)).toBe(true);
    }
  });

  it("rejects an arbitrary string", () => {
    expect(isCampaignSortKey("popularity")).toBe(false);
  });
});
