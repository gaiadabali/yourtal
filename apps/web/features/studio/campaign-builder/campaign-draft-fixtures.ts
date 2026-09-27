import { createChapter } from "./campaign-chapter";
import type { CampaignDraft } from "./campaign-draft";
import { createEmptyQuestionDraft } from "../question-bank/question-draft";

/** A fresh, empty draft — used both by "New campaign" in the screen and as the base every fixture below starts from. */
export function createEmptyCampaignDraft(
  businessId: string,
  merchantName: string,
  idFactory: () => string = () => crypto.randomUUID(),
): CampaignDraft {
  return {
    id: idFactory(),
    businessId,
    title: "",
    synopsis: "",
    merchantName,
    kind: "long_form",
    video: { fileName: null, status: "idle", progressPercent: 0 },
    chapters: [],
    rewardPoints: 0,
    scoringRule: "base_only",
    targeting: { interests: [], districts: [] },
    budget: { totalBudgetPoints: 0, dailyCapPoints: null },
    questionBank: [],
    status: "draft",
    rejectionReason: null,
    updatedAt: new Date(0).toISOString(),
  };
}

let fixtureIdCounter = 0;
/** Deterministic ids for the fixed demo fixtures below — never random, so a rendered screenshot or a test snapshot does not change between runs. */
function fixtureId(): string {
  fixtureIdCounter += 1;
  return `00000000-0000-4000-8000-0000000009${fixtureIdCounter.toString().padStart(2, "0")}`;
}

/**
 * One hand-authored draft per workflow status (docs/tasks/phase-u-ui.md
 * YT-0441: "Draft, in-review, live, paused and rejected states designed,
 * with rejection reasons") — deterministic, not randomly generated, so
 * every one of the five states is genuinely reachable and testable rather
 * than showing up only some of the time.
 */
export function buildDemoCampaignDrafts(businessId: string, merchantName: string): CampaignDraft[] {
  const draftCampaign: CampaignDraft = {
    ...createEmptyCampaignDraft(businessId, merchantName, fixtureId),
    title: "Kopi Kenangan — Cold Brew Launch",
    synopsis: "Introduces the new cold brew line and the launch-week voucher.",
    chapters: [
      createChapter("Intro", 0, fixtureId),
      createChapter("Product walkthrough", 120, fixtureId),
    ],
    rewardPoints: 800,
    budget: { totalBudgetPoints: 500_000, dailyCapPoints: 20_000 },
    status: "draft",
  };

  const inReviewQuestion = createEmptyQuestionDraft("multiple_choice", draftCampaign.id, fixtureId);
  inReviewQuestion.prompt = "What is the name of the new cold brew flavour?";
  const [firstOption, secondOption] = inReviewQuestion.options;
  if (!firstOption || !secondOption) {
    throw new Error("createEmptyQuestionDraft did not create the expected two starter options");
  }
  firstOption.label = "Hazelnut Aren";
  secondOption.label = "Vanilla Oat";
  inReviewQuestion.correctOptionId = firstOption.id;

  const inReviewCampaign: CampaignDraft = {
    ...createEmptyCampaignDraft(businessId, merchantName, fixtureId),
    title: "Kopi Kenangan — Loyalty Card Explainer",
    synopsis: "Explains how the loyalty card's tenth-cup-free reward works.",
    chapters: [
      createChapter("Intro", 0, fixtureId),
      createChapter("How it works", 180, fixtureId),
      createChapter("Sign-up", 420, fixtureId),
    ],
    rewardPoints: 1_200,
    scoringRule: "base_plus_accuracy_bonus",
    questionBank: [inReviewQuestion],
    budget: { totalBudgetPoints: 1_200_000, dailyCapPoints: null },
    status: "in_review",
  };

  const liveCampaign: CampaignDraft = {
    ...createEmptyCampaignDraft(businessId, merchantName, fixtureId),
    title: "Kopi Kenangan — Ramadan Bundle",
    synopsis: "The Ramadan sahur bundle, now live on the Earn board.",
    chapters: [
      createChapter("Intro", 0, fixtureId),
      createChapter("Bundle contents", 90, fixtureId),
    ],
    rewardPoints: 3_000,
    scoringRule: "base_plus_accuracy_bonus",
    budget: { totalBudgetPoints: 2_000_000, dailyCapPoints: 100_000 },
    status: "live",
  };

  const pausedCampaign: CampaignDraft = {
    ...createEmptyCampaignDraft(businessId, merchantName, fixtureId),
    title: "Kopi Kenangan — Merch Drop",
    synopsis: "Limited-run merchandise drop, paused while restock is confirmed.",
    chapters: [
      createChapter("Intro", 0, fixtureId),
      createChapter("Merch showcase", 60, fixtureId),
    ],
    rewardPoints: 500,
    budget: { totalBudgetPoints: 300_000, dailyCapPoints: 15_000 },
    status: "paused",
  };

  const rejectedCampaign: CampaignDraft = {
    ...createEmptyCampaignDraft(businessId, merchantName, fixtureId),
    title: "Kopi Kenangan — Refer a Friend",
    synopsis: "Asks viewers to refer a friend for a bonus voucher.",
    chapters: [
      createChapter("Intro", 0, fixtureId),
      createChapter("Referral steps", 40, fixtureId),
    ],
    rewardPoints: 50,
    budget: { totalBudgetPoints: 100_000, dailyCapPoints: null },
    status: "rejected",
    rejectionReason:
      "The reward (50 points, worth roughly the price of the data used to watch it) is far too small for the attention asked — see the reward-to-data-cost banner in the builder. Increase the reward or shorten the video before resubmitting.",
  };

  return [draftCampaign, inReviewCampaign, liveCampaign, pausedCampaign, rejectedCampaign];
}
