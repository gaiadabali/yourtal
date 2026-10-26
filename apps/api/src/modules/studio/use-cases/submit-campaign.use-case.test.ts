import { describe, expect, it } from "vitest";
import type { Question } from "@yourtal/contracts/question";
import type { BusinessAccountRepository } from "../../business/persistence/business-account.repository";
import type { CampaignPublishedPublisher } from "../campaign-published-publisher";
import type {
  CampaignDraft,
  CampaignDraftRepository,
} from "../persistence/campaign-draft.repository";
import type { BankQuestionRecord } from "../persistence/question-bank.repository";
import { submitCampaign } from "./submit-campaign.use-case";

const READY: CampaignDraft = {
  id: "campaign-1",
  businessId: "business-1",
  region: "AU",
  kind: "long_form",
  title: "Two for one",
  synopsis: "Two coffees for one, all week.",
  durationSeconds: 20,
  contentCategory: "food-and-drink",
  audience: "all_ages",
  lifecycleState: "draft",
  rejectionReason: null,
  startsAt: new Date().toISOString(),
  endsAt: new Date(Date.now() + 86_400_000).toISOString(),
  openViewing: false,
  teaserStartSeconds: 0,
  posterFrameSeconds: null,
  declaredInterests: [],
  chapters: [],
  captionsUrl: null,
  posterUrl: "https://media.test/poster.jpg",
  teaserUrl: "https://media.test/teaser.mp4",
  hlsUrl: "https://media.test/index.m3u8",
  rewardPoints: 2,
  questionCount: 0,
  scoringRule: "base_only",
  publishedAt: null,
  targetDistricts: [],
  rewardConfig: {
    allocationId: "alloc-1",
    rewardPointsPerCompletion: 2,
    accuracyBonusPoints: 0,
    maxPointsForCampaign: 100,
    dailyCapPoints: null,
  },
};

function deps(draft: CampaignDraft, bank: readonly BankQuestionRecord[] = []) {
  const transitions: string[] = [];
  const drafts = {
    findById: () => Promise.resolve(draft),
    transitionLifecycle: (_b: string, _c: string, to: string) => {
      transitions.push(to);
      return Promise.resolve({ ok: true as const, draft: { ...draft, lifecycleState: to } });
    },
  } as unknown as CampaignDraftRepository;
  return {
    transitions,
    deps: {
      businesses: {
        findById: () => Promise.resolve({ id: "business-1", isVerified: true }),
      } as unknown as BusinessAccountRepository,
      drafts,
      bank: { listByCampaign: () => Promise.resolve(bank) },
      rewardConfigs: {} as never,
      termsVersions: {} as never,
      publisher: {} as unknown as CampaignPublishedPublisher,
      moderation: {
        classify: () => Promise.resolve({ isOk: () => true, value: { outcome: "pass" } }),
      } as never,
    },
  };
}

describe("submitCampaign readiness (B6, B7)", () => {
  it("names what is missing instead of letting the database refuse the move", async () => {
    const { deps: d, transitions } = deps({
      ...READY,
      hlsUrl: null,
      posterUrl: null,
      teaserUrl: null,
      rewardConfig: null,
      rewardPoints: null,
    });

    const result = await submitCampaign(d, "business-1", "campaign-1");

    expect(result._unsafeUnwrapErr()).toMatchObject({
      type: "campaign_not_ready",
      missing: ["video", "reward"],
    });
    expect(transitions).toEqual([]);
  });

  it("refuses a draft with no synopsis, which a new draft may now start without", async () => {
    const { deps: d } = deps({ ...READY, synopsis: "" });
    expect((await submitCampaign(d, "business-1", "campaign-1"))._unsafeUnwrapErr()).toMatchObject({
      type: "campaign_not_ready",
      missing: ["synopsis"],
    });
  });

  it("refuses a bank too small for the video's length, with the counts", async () => {
    const { deps: d } = deps({ ...READY, durationSeconds: 90 }, [
      {
        question: { id: "q" } as unknown as Question,
        status: "draft",
        piiScreen: "clear",
        timesAsked: 0,
        timesCorrect: 0,
        retiredReason: null,
      },
    ]);
    expect((await submitCampaign(d, "business-1", "campaign-1"))._unsafeUnwrapErr()).toMatchObject({
      type: "campaign_not_ready",
      missing: ["questions"],
      questionsNeeded: 3,
      questionsHave: 1,
    });
  });

  it("moves a complete draft to review", async () => {
    const { deps: d, transitions } = deps(READY);
    const result = await submitCampaign(d, "business-1", "campaign-1");
    expect(result.isOk()).toBe(true);
    expect(transitions).toEqual(["in_review"]);
  });

  it("leaves a campaign that is already past draft to the lifecycle's own refusal, not a gap list", async () => {
    const { deps: d } = deps({ ...READY, lifecycleState: "in_review", hlsUrl: null });
    expect((await submitCampaign(d, "business-1", "campaign-1"))._unsafeUnwrapErr()).toMatchObject({
      type: "illegal_transition",
    });
  });
});
