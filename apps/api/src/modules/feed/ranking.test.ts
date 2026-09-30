import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Campaign } from "@yourtal/contracts/campaign";
import type { CampaignRewardConfigRow } from "../campaign/persistence/campaign.repository";
import { buildFeed, passesFilter } from "./ranking";
import type { CandidateCampaign, RankingContext } from "./ranking";

const NOW = new Date("2026-09-27T12:00:00.000Z");

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: randomUUID(),
    kind: "quick",
    title: "Test campaign",
    merchantId: randomUUID(),
    merchantName: "Test Merchant",
    synopsis: "A campaign for ranking.test.ts.",
    durationSeconds: 30,
    estimatedDataMb: 10,
    rewardPoints: 100 as Campaign["rewardPoints"],
    questionCount: 0,
    scoringRule: "base_only",
    status: "active",
    publishedAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    chapters: [],
    videoSource: { kind: "hls", manifestUrl: "https://cdn.example.com/manifest.m3u8" },
    businessId: randomUUID(),
    region: "AU",
    audience: "all_ages",
    contentCategory: "food-and-drink",
    posterUrl: "https://cdn.example.com/poster.jpg",
    teaserUrl: "https://cdn.example.com/teaser.mp4",
    hlsUrl: "https://cdn.example.com/manifest.m3u8",
    captionsUrl: null,
    aspect: "9:16",
    estimatedBytes: 1_000_000,
    startsAt: new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    endsAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    openViewing: false,
    teaserStartSeconds: 0,
    ...overrides,
  };
}

function rewardConfig(overrides: Partial<CampaignRewardConfigRow> = {}): CampaignRewardConfigRow {
  return {
    campaignId: randomUUID(),
    allocationId: randomUUID(),
    funderType: "partner",
    maxPointsForCampaign: 100_000,
    rewardPointsPerCompletion: 100,
    accuracyBonusPoints: 0,
    ...overrides,
  };
}

function candidate(overrides: Partial<CandidateCampaign> = {}): CandidateCampaign {
  const base = campaign(overrides.campaign);
  return {
    campaign: base,
    rewardConfig: rewardConfig({ campaignId: base.id, ...overrides.rewardConfig }),
    allocationRemainingPoints: 10_000,
    allocationTotalPoints: 10_000,
    ...overrides,
  };
}

function baseContext(overrides: Partial<RankingContext> = {}): RankingContext {
  return {
    now: NOW,
    viewerRegion: "AU",
    audiences: ["all_ages"],
    ageBand: undefined,
    hasParentBoost: false,
    followedBusinessIds: new Set(),
    declaredInterestNodeIds: new Set(),
    interestTargetingAllowed: false,
    minSegmentSize: 1_000,
    segmentSizeOf: () => 0,
    alreadyEarnedCampaignIds: new Set(),
    demotedCampaignIds: new Set(),
    canServe: () => true,
    anonymous: false,
    channelOf: () => ({ handle: "test-channel", logoUrl: null }),
    ...overrides,
  };
}

describe("passesFilter", () => {
  it("excludes a campaign with no remaining allocation", () => {
    const c = candidate({ allocationRemainingPoints: 0 });
    expect(passesFilter(c, baseContext())).toBe(false);
  });

  it("excludes a campaign outside the viewer's region", () => {
    const c = candidate({ campaign: campaign({ region: "ID" }) });
    expect(passesFilter(c, baseContext({ viewerRegion: "AU" }))).toBe(false);
  });

  it("excludes a campaign whose audience the viewer cannot reach", () => {
    const c = candidate({ campaign: campaign({ audience: "adult" }) });
    expect(passesFilter(c, baseContext({ audiences: ["all_ages"] }))).toBe(false);
  });

  it("excludes anything not openViewing for an anonymous viewer, even all_ages", () => {
    const c = candidate({ campaign: campaign({ audience: "all_ages", openViewing: false }) });
    expect(passesFilter(c, baseContext({ anonymous: true, audiences: ["all_ages"] }))).toBe(false);
  });

  it("admits an openViewing all_ages campaign for an anonymous viewer", () => {
    const c = candidate({ campaign: campaign({ audience: "all_ages", openViewing: true }) });
    expect(passesFilter(c, baseContext({ anonymous: true, audiences: ["all_ages"] }))).toBe(true);
  });

  it("excludes a campaign this signed-in viewer already earned", () => {
    const c = candidate();
    const ctx = baseContext({ alreadyEarnedCampaignIds: new Set([c.campaign.id]) });
    expect(passesFilter(c, ctx)).toBe(false);
  });

  it("excludes a campaign outside its schedule window", () => {
    const ended = candidate({
      campaign: campaign({ endsAt: new Date(NOW.getTime() - 1000).toISOString() }),
    });
    expect(passesFilter(ended, baseContext())).toBe(false);
  });

  it("excludes a campaign pacing has capped for today", () => {
    const c = candidate();
    expect(passesFilter(c, baseContext({ canServe: () => false }))).toBe(false);
  });
});

describe("buildFeed", () => {
  it("never returns a campaign with no funded allocation", () => {
    const funded = candidate({ allocationRemainingPoints: 500 });
    const unfunded = candidate({ allocationRemainingPoints: 0 });
    const items = buildFeed([funded, unfunded], baseContext());
    expect(items.map((item) => item.campaignId)).toEqual([funded.campaign.id]);
  });

  it("ranks a followed business's campaign above an equivalent one from a stranger", () => {
    const followedBusinessId = randomUUID();
    const followed = candidate({ campaign: campaign({ businessId: followedBusinessId }) });
    const stranger = candidate();
    const ctx = baseContext({ followedBusinessIds: new Set([followedBusinessId]) });

    const items = buildFeed([stranger, followed], ctx);
    expect(items[0]?.campaignId).toBe(followed.campaign.id);
    expect(items[0]?.why).toContain("follow");
  });

  it("12.2.a: ranks a teen-audience campaign above an equivalent all_ages one for a teen viewer", () => {
    const teenItem = candidate({ campaign: campaign({ audience: "teen" }) });
    const allAgesItem = candidate({ campaign: campaign({ audience: "all_ages" }) });
    const ctx = baseContext({ audiences: ["all_ages", "teen"], ageBand: "teen" });

    const items = buildFeed([allAgesItem, teenItem], ctx);
    expect(items[0]?.campaignId).toBe(teenItem.campaign.id);
    expect(items[0]?.whyReason).toBe("audience");
  });

  it("does not boost a matching declared interest without consent, even above the segment floor", () => {
    const category = "food-and-drink";
    const matching = candidate({ campaign: campaign({ contentCategory: category }) });
    const other = candidate({ campaign: campaign({ contentCategory: "travel" }) });
    const ctxNoConsent = baseContext({
      declaredInterestNodeIds: new Set([category]),
      interestTargetingAllowed: false,
      minSegmentSize: 1,
      segmentSizeOf: () => 1_000_000,
    });

    const withoutConsent = buildFeed([other, matching], ctxNoConsent);
    // Same reward/freshness on both sides -- with no interest boost applied,
    // order falls back to insertion (stable sort), i.e. no reordering by
    // interest at all.
    expect(withoutConsent.find((item) => item.campaignId === matching.campaign.id)?.why).not.toBe(
      "Matches an interest you declared",
    );

    const ctxWithConsent = baseContext({
      declaredInterestNodeIds: new Set([category]),
      interestTargetingAllowed: true,
      minSegmentSize: 1,
      segmentSizeOf: () => 1_000_000,
    });
    const withConsent = buildFeed([other, matching], ctxWithConsent);
    expect(withConsent[0]?.campaignId).toBe(matching.campaign.id);
    expect(withConsent[0]?.why).toBe("Matches an interest you declared");
  });

  it("does not apply an interest boost below the F12 minimum segment size, even with consent", () => {
    const category = "food-and-drink";
    const matching = candidate({ campaign: campaign({ contentCategory: category }) });
    const other = candidate({ campaign: campaign({ contentCategory: "travel" }) });
    const ctx = baseContext({
      declaredInterestNodeIds: new Set([category]),
      interestTargetingAllowed: true,
      minSegmentSize: 1_000,
      segmentSizeOf: () => 5, // far below the floor
    });

    const items = buildFeed([other, matching], ctx);
    expect(items.find((item) => item.campaignId === matching.campaign.id)?.why).not.toBe(
      "Matches an interest you declared",
    );
  });

  it("demotes a campaign the viewer said they were not interested in, without removing it", () => {
    const demoted = candidate();
    const other = candidate();
    const ctx = baseContext({ demotedCampaignIds: new Set([demoted.campaign.id]) });

    const items = buildFeed([demoted, other], ctx);
    expect(items.map((item) => item.campaignId)).toContain(demoted.campaign.id);
    expect(items[0]?.campaignId).toBe(other.campaign.id);
  });

  it("caps a single business at 2 in a row when other businesses are available", () => {
    const businessId = randomUUID();
    const sameBusiness = [
      candidate({ campaign: campaign({ businessId }) }),
      candidate({ campaign: campaign({ businessId }) }),
      candidate({ campaign: campaign({ businessId }) }),
    ];
    const other = candidate();
    const items = buildFeed([...sameBusiness, other], baseContext());

    const businessIds = items.map((item) => item.businessId);
    expect(businessIds[0]).toBe(businessId);
    expect(businessIds[1]).toBe(businessId);
    expect(businessIds[2]).not.toBe(businessId);
  });

  it("marks a campaign ending soon", () => {
    const soon = candidate({
      campaign: campaign({ endsAt: new Date(NOW.getTime() + 60 * 60 * 1000).toISOString() }),
    });
    const items = buildFeed([soon], baseContext());
    expect(items[0]?.endingSoon).toBe(true);
  });

  // 12.4.d/#7: no scarcity nudge for a teen, ever -- not the per-item flag,
  // not the "Ending soon" why reason, regardless of how close the campaign
  // actually is to ending.
  it("never marks a campaign ending soon for a teen viewer, even one that genuinely is", () => {
    const soon = candidate({
      campaign: campaign({
        audience: "all_ages",
        endsAt: new Date(NOW.getTime() + 60 * 60 * 1000).toISOString(),
      }),
    });
    const ctx = baseContext({ audiences: ["all_ages", "teen"], ageBand: "teen" });
    const items = buildFeed([soon], ctx);
    expect(items[0]?.endingSoon).toBe(false);
    expect(items[0]?.whyReason).not.toBe("ending_soon");
  });

  it("carries the honest terms line: kind, questions, data and base plus the maximum bonus (F78)", () => {
    const withBonus = candidate({
      campaign: campaign({ questionCount: 3, estimatedDataMb: 120 }),
      rewardConfig: rewardConfig({ rewardPointsPerCompletion: 90, accuracyBonusPoints: 22 }),
    });
    const [item] = buildFeed([withBonus], baseContext());
    expect(item).toMatchObject({
      kind: withBonus.campaign.kind,
      questionCount: 3,
      estimatedDataMb: 120,
      rewardPoints: 90,
      maxRewardPoints: 112,
      whyReason: "popular",
    });
  });
});
