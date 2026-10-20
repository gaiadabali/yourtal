import { randomUUID } from "node:crypto";
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import type { Principal } from "@yourtal/authz/principal";
import type { Campaign } from "@yourtal/contracts/campaign";
import type { CampaignRepository } from "../../campaign/persistence/campaign.repository";
import { search } from "./search.use-case";

/** 14.2 / 1.6.i: search matches district-targeted campaigns the way the feed does. */

const POSTCODE = "2026";
const OTHER_POSTCODE = "3000";

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: randomUUID(),
    kind: "quick",
    title: "Bondi coffee",
    merchantId: randomUUID(),
    merchantName: "Test Merchant",
    synopsis: "A campaign for search.use-case.test.ts.",
    durationSeconds: 30,
    estimatedDataMb: 10,
    rewardPoints: 100 as Campaign["rewardPoints"],
    questionCount: 0,
    scoringRule: "base_only",
    status: "active",
    publishedAt: new Date(Date.now() - 86_400_000).toISOString(),
    chapters: [],
    videoSource: { kind: "hls", manifestUrl: "https://cdn.example.com/manifest.m3u8" },
    businessId: randomUUID(),
    region: "AU",
    audience: "all_ages",
    contentCategory: "food-and-drink",
    tags: [],
    posterUrl: "https://cdn.example.com/poster.jpg",
    teaserUrl: "https://cdn.example.com/teaser.mp4",
    hlsUrl: "https://cdn.example.com/manifest.m3u8",
    captionsUrl: null,
    aspect: "9:16",
    estimatedBytes: 1_000_000,
    startsAt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
    endsAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    openViewing: true,
    teaserStartSeconds: 0,
    ...overrides,
  };
}

interface Seed {
  readonly campaign: Campaign;
  readonly districts: readonly string[];
}

function run(
  seeds: readonly Seed[],
  principal: Principal,
  options: { area?: string | null; district?: string; region?: "AU" | "ID" } = {},
) {
  const byId = new Map(seeds.map((seed) => [seed.campaign.id, seed]));
  const repo = {
    listVisible: () => Promise.resolve(seeds.map((seed) => seed.campaign)),
    rewardConfigFor: (id: string) =>
      Promise.resolve({
        campaignId: id,
        allocationId: id,
        funderType: "partner",
        maxPointsForCampaign: 100_000,
        rewardPointsPerCompletion: 100,
        accuracyBonusPoints: 0,
      }),

    targetDistrictsFor: (ids: readonly string[]) =>
      Promise.resolve(new Map(ids.map((id) => [id, byId.get(id)?.districts ?? []]))),
  } as unknown as CampaignRepository;
  const ledger = {
    getAllocation: () => okAsync({ remainingPoints: 10_000, totalPoints: 10_000 }),
    campaignBudgets: () => errAsync({ kind: "unavailable" }),
  } as never;
  let areaReads = 0;
  const signals = {
    declaredAreaPostcode: () => {
      areaReads += 1;
      return Promise.resolve(options.area ?? null);
    },
  };
  return search(
    repo,
    ledger,
    { search: () => Promise.resolve([]) },
    { browsePublic: () => Promise.resolve({ listings: [] }) } as never,
    { suspendedIds: () => Promise.resolve(new Set<string>()) },
    { channelsFor: () => Promise.resolve(new Map()) },
    signals,
    principal,
    "coffee",
    options.region,
    { district: options.district },
  ).then((outcome) => ({ outcome, areaReads: () => areaReads }));
}

function viewer(ageBand: "adult" | "teen" = "adult", jurisdiction: "AU" | "ID" = "AU"): Principal {
  return {
    id: randomUUID(),
    roles: ["user"],
    attr: { jurisdiction, businessRoles: {}, isSuspended: false, ageBand },
  };
}

const ANONYMOUS: Principal = {
  id: "anonymous",
  roles: [],
  attr: { businessRoles: {}, isSuspended: false },
} as unknown as Principal;

function ids(outcome: Awaited<ReturnType<typeof run>>["outcome"]): string[] {
  if (outcome.kind !== "ok") throw new Error("expected ok");
  return outcome.result.campaigns.map((item) => item.campaignId);
}

describe("search: district targeting", () => {
  const targeted = { campaign: campaign({ title: "Targeted coffee" }), districts: [POSTCODE] };
  const open = { campaign: campaign({ title: "Untargeted coffee" }), districts: [] };

  it("finds a targeted campaign for a viewer whose area is in its postcode", async () => {
    const { outcome } = await run([targeted, open], viewer(), { area: POSTCODE });
    expect(ids(outcome).sort()).toEqual([targeted.campaign.id, open.campaign.id].sort());
  });

  it("hides it from a viewer elsewhere, and from one with no area, but keeps untargeted", async () => {
    const elsewhere = await run([targeted, open], viewer(), { area: OTHER_POSTCODE });
    expect(ids(elsewhere.outcome)).toEqual([open.campaign.id]);
    const none = await run([targeted, open], viewer(), { area: null });
    expect(ids(none.outcome)).toEqual([open.campaign.id]);
  });

  it("an explicit district wins over the viewer's own area, as in the feed", async () => {
    const { outcome } = await run([targeted, open], viewer(), {
      area: OTHER_POSTCODE,
      district: POSTCODE,
    });
    expect(ids(outcome)).toContain(targeted.campaign.id);
  });

  it("an anonymous viewer sees it only with an explicit district, and never reads an area", async () => {
    const bare = await run([targeted, open], ANONYMOUS, { region: "AU", area: POSTCODE });
    expect(ids(bare.outcome)).toEqual([open.campaign.id]);
    expect(bare.areaReads()).toBe(0);
    const named = await run([targeted, open], ANONYMOUS, { region: "AU", district: POSTCODE });
    expect(ids(named.outcome)).toContain(targeted.campaign.id);
  });

  it("a teen's declared area is never read; only an explicit district counts", async () => {
    const teen = await run([targeted, open], viewer("teen"), { area: POSTCODE });
    expect(ids(teen.outcome)).toEqual([open.campaign.id]);
    expect(teen.areaReads()).toBe(0);
  });

  it("never crosses regions, even when the postcode matches", async () => {
    const idCampaign = {
      campaign: campaign({ title: "Indonesian coffee", region: "ID" }),
      districts: [POSTCODE],
    };
    const au = await run([idCampaign, targeted], viewer(), { area: POSTCODE });
    expect(ids(au.outcome)).toEqual([targeted.campaign.id]);
    const id = await run([idCampaign, targeted], viewer("adult", "ID"), { area: POSTCODE });
    expect(ids(id.outcome)).toEqual([idCampaign.campaign.id]);
  });
});
