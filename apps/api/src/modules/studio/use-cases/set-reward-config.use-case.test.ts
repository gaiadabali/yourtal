import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import type { Allocation } from "@yourtal/contracts/ledger-internal/funding";
import type { RegionSetting } from "@yourtal/contracts/ledger-internal/settings";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import type {
  CampaignDraft,
  CampaignDraftRepository,
} from "../persistence/campaign-draft.repository";
import type {
  RewardConfigRecord,
  RewardConfigRepository,
} from "../persistence/reward-config.repository";
import { setRewardConfig } from "./set-reward-config.use-case";
import type { SetRewardConfigInput } from "./set-reward-config.use-case";

/**
 * F61/TASKS.md 7.3.h's atomicity requirement, checked directly: a ledger
 * valuation failure AFTER the reward config already saved must not turn
 * into a 500 for a write that succeeded (7.1.e's own class of bug, applied
 * here to a second, independent ledger call rather than to the save
 * itself). Stubs, not a real Postgres/ledger — this is one use-case's own
 * control flow, and `ledger-client.contract.spec.ts` (run against a real,
 * live ledger) is what proves `valuePoints` itself prices correctly.
 */
const DRAFT: CampaignDraft = {
  id: "campaign-1",
  businessId: "business-1",
  region: "AU",
  kind: "long_form",
  title: "Test campaign",
  synopsis: "synopsis",
  durationSeconds: 1_200,
  contentCategory: "food-and-drink",
  audience: "all_ages",
  lifecycleState: "draft",
  rejectionReason: null,
  startsAt: new Date().toISOString(),
  endsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  openViewing: false,
  teaserStartSeconds: 0,
  posterFrameSeconds: null,
  declaredInterests: [],
  chapters: [],
  captionsUrl: null,
  posterUrl: null,
  teaserUrl: null,
  hlsUrl: null,
  rewardPoints: null,
  questionCount: null,
  scoringRule: null,
  publishedAt: null,
};

const ALLOCATION: Allocation = {
  allocationId: "alloc-1",
  businessId: "business-1",
  region: "AU",
  funderType: "partner",
  totalPoints: toPoints(10_000),
  remainingPoints: toPoints(10_000),
  createdAt: new Date().toISOString(),
};

const CEILING_SETTING: RegionSetting = {
  id: "setting-1",
  region: "AU",
  key: "reward_ceiling_points_per_minute",
  value: 8,
  setBy: "founder",
  approvedBy: "founder",
  effectiveFrom: new Date().toISOString(),
};

const INPUT: SetRewardConfigInput = {
  businessId: "business-1",
  campaignId: "campaign-1",
  allocationId: "alloc-1",
  rewardPointsPerCompletion: toPoints(115),
  accuracyBonusPoints: toPoints(45),
  maxPointsForCampaign: toPoints(160),
};

/** A drafts stub whose `patchRewardMirror` is the save's second half — its own call is asserted via the CampaignDraft it returns. */
function draftsStub(): CampaignDraftRepository {
  return {
    create: () => Promise.reject(new Error("not used")),
    findById: () => Promise.resolve(DRAFT),
    listByBusiness: () => Promise.reject(new Error("not used")),
    findByIdAnyBusiness: () => Promise.reject(new Error("not used")),
    listInReview: () => Promise.reject(new Error("not used")),
    update: () => Promise.reject(new Error("not used")),
    patchRewardMirror: (_businessId, _campaignId, mirror) =>
      Promise.resolve({ ...DRAFT, ...mirror }),
    transitionLifecycle: () => Promise.reject(new Error("not used")),
  };
}

function rewardConfigsStub(): RewardConfigRepository & { upsertCalls: RewardConfigRecord[] } {
  const upsertCalls: RewardConfigRecord[] = [];
  return {
    upsertCalls,
    upsert: (input: RewardConfigRecord) => {
      upsertCalls.push(input);
      return Promise.resolve(input);
    },
    findByCampaignId: () => Promise.resolve(null),
  };
}

describe("setRewardConfig (7.3.c/7.3.h)", () => {
  it("saves and returns the priced value when valuePoints succeeds", async () => {
    const drafts = draftsStub();
    const rewardConfigs = rewardConfigsStub();
    const ledger: Pick<LedgerInternalClient, "listAllocations" | "getSettings" | "valuePoints"> = {
      listAllocations: () => okAsync([ALLOCATION]),
      getSettings: () => Promise.resolve([CEILING_SETTING]),
      valuePoints: () => okAsync({ totalMinor: toMinorUnits(36), currency: "AUD" }),
    };

    const result = await setRewardConfig({ drafts, rewardConfigs, ledger }, INPUT);

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.rewardValueMinor).toBe(36);
    expect(value.currency).toBe("AUD");
    expect(rewardConfigs.upsertCalls).toHaveLength(1);
  });

  /**
   * F61's atomicity check: the save already committed by the time
   * `valuePoints` runs. Its failure must degrade to a null value, not
   * report the whole PUT as failed -- the exact "commits but the caller is
   * told it failed" shape 7.1.e fixed for the reward config's OWN save,
   * applied here to a second, independent, display-only call.
   */
  it("still saves and returns a null value when valuePoints fails, rather than failing the request", async () => {
    const drafts = draftsStub();
    const rewardConfigs = rewardConfigsStub();
    const ledger: Pick<LedgerInternalClient, "listAllocations" | "getSettings" | "valuePoints"> = {
      listAllocations: () => okAsync([ALLOCATION]),
      getSettings: () => Promise.resolve([CEILING_SETTING]),
      valuePoints: () => errAsync({ code: "region_mismatch", message: "simulated ledger outage" }),
    };

    const result = await setRewardConfig({ drafts, rewardConfigs, ledger }, INPUT);

    // The whole point: this is Ok, not Err -- a caller sees 200/201, never a 500.
    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.rewardValueMinor).toBeNull();
    expect(value.currency).toBeNull();
    // The save itself ran exactly once, unconditional on valuePoints.
    expect(rewardConfigs.upsertCalls).toHaveLength(1);
    expect(rewardConfigs.upsertCalls[0]).toMatchObject({
      campaignId: "campaign-1",
      allocationId: "alloc-1",
    });
  });
});
