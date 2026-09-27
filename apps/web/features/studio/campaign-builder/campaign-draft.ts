import type { CampaignKind, CampaignScoringRule } from "@yourtal/contracts/campaign";
import type { CampaignChapter } from "./campaign-chapter";
import { estimateDataMb, totalDurationSeconds } from "./campaign-chapter";
import type { CampaignDraftStatus } from "./campaign-draft-status";
import type { QuestionDraft } from "../question-bank/question-draft";
import { toPublishableQuestionInput } from "../question-bank/question-draft-to-question";

/**
 * The campaign builder's authoring-time shape. `kind`/`scoringRule` are
 * `import type`-only from `@yourtal/contracts/campaign` (free —
 * `verbatimModuleSyntax` erases type-only imports) so this file never
 * drags the ~96 KB gz Zod runtime `campaignSchema` carries into a
 * client-reachable module (docs/13b-typescript-standards.md §8).
 *
 * This is intentionally NOT `Campaign` — it carries authoring-only fields
 * (chapters, video upload state, targeting, budget, review status,
 * rejection reason) the published contract has no reason to model, plus
 * looser field types mid-authoring (`rewardPoints: number`, not the
 * branded `Points`) since a draft is allowed to be incomplete or
 * momentarily invalid while someone is typing. `campaign-entry-preview.tsx`
 * renders the same facts the real entry card contract requires (duration,
 * data cost, reward, question count, scoring rule) computed straight off
 * this shape via `campaign-preview-format.ts`'s dependency-free helpers —
 * see that file's doc comment for why it does not construct and render an
 * actual `Campaign` through the real `CampaignEntryCard` component.
 */
export interface CampaignVideoUpload {
  fileName: string | null;
  status: "idle" | "uploading" | "processing" | "ready" | "failed";
  progressPercent: number;
}

export interface CampaignTargeting {
  interests: string[];
  districts: string[];
}

export interface CampaignBudget {
  totalBudgetPoints: number;
  dailyCapPoints: number | null;
}

export interface CampaignDraft {
  id: string;
  businessId: string;
  title: string;
  synopsis: string;
  merchantName: string;
  kind: CampaignKind;
  video: CampaignVideoUpload;
  chapters: CampaignChapter[];
  rewardPoints: number;
  scoringRule: CampaignScoringRule;
  targeting: CampaignTargeting;
  budget: CampaignBudget;
  questionBank: QuestionDraft[];
  status: CampaignDraftStatus;
  rejectionReason: string | null;
  updatedAt: string;
}

export function draftDurationSeconds(draft: CampaignDraft): number {
  return totalDurationSeconds(draft.chapters);
}

export function draftEstimatedDataMb(draft: CampaignDraft): number {
  return estimateDataMb(draftDurationSeconds(draft));
}

/** How many questions are actually complete enough to be asked — an empty or half-written draft question does not count. */
export function draftCompleteQuestionCount(draft: CampaignDraft): number {
  return draft.questionBank.filter((question) => toPublishableQuestionInput(question) !== null)
    .length;
}

const MAX_TITLE_LENGTH = 140;
const MAX_SYNOPSIS_LENGTH = 500;

export interface CampaignDraftFormValues {
  title: string;
  synopsis: string;
  rewardPoints: number;
  totalBudgetPoints: number;
}

export function draftFormValues(draft: CampaignDraft): CampaignDraftFormValues {
  return {
    title: draft.title,
    synopsis: draft.synopsis,
    rewardPoints: draft.rewardPoints,
    totalBudgetPoints: draft.budget.totalBudgetPoints,
  };
}

export type CampaignDraftFieldErrors = Partial<Record<keyof CampaignDraftFormValues, string>>;

/**
 * Validates the editable text/number fields of a draft — the fields a form
 * field can get wrong by itself (title too long, negative reward). It
 * deliberately does NOT re-validate cross-field platform rules that already
 * have their own dedicated, explanatory evaluator (the bank-size rule in
 * `question-bank-rules.ts`, the reward/data-cost ratio in
 * `campaign-reward-risk.ts`) — those are advisories with their own richer
 * messaging, not a pass/fail this function should flatten into one error.
 *
 * Takes the flat `CampaignDraftFormValues` (not the full `CampaignDraft`) so
 * it can be called directly as-is from both a unit test and
 * `campaign-draft-form.ts`'s React Hook Form resolver, which only ever has
 * the form's own field values in hand, never the whole draft.
 *
 * Hand-rolled rather than a `zod/mini` schema: this runs in a client leaf
 * (`campaign-editor.tsx`) on every keystroke of a route that was, in an
 * earlier version of this file, ~13 KB gz over the 200 KB hard gate —
 * measured, not assumed (see this ticket's report). `zod/mini`'s shared
 * parsing core (regex tables for uuid/email/iso formats this schema never
 * used, the check/pipe machinery) still cost ~20 KB gz on its own even for
 * these four trivial checks, confirmed by inspecting the actual produced
 * chunk. Four `if` statements validate exactly the same four rules for
 * zero bytes, which is the better trade for a form this small — `zod/mini`
 * remains the right tool for a real discriminated-union shape, just not for
 * this one. YT-0525 wired React Hook Form on top of this exact function
 * (via `campaign-draft-form.ts`'s hand-written resolver) instead of
 * replacing it with a schema, for the same measured reason.
 */
export function validateCampaignDraftForm(
  values: CampaignDraftFormValues,
): CampaignDraftFieldErrors {
  const errors: CampaignDraftFieldErrors = {};

  if (values.title.trim().length === 0) {
    errors.title = "Give the campaign a title.";
  } else if (values.title.length > MAX_TITLE_LENGTH) {
    errors.title = `Keep the title to ${MAX_TITLE_LENGTH} characters or fewer.`;
  }

  if (values.synopsis.trim().length === 0) {
    errors.synopsis = "Add a short synopsis — this is what the viewer sees before starting.";
  } else if (values.synopsis.length > MAX_SYNOPSIS_LENGTH) {
    errors.synopsis = `Keep the synopsis to ${MAX_SYNOPSIS_LENGTH} characters or fewer.`;
  }

  if (!Number.isFinite(values.rewardPoints) || values.rewardPoints < 0) {
    errors.rewardPoints = "Reward cannot be negative.";
  }

  if (!Number.isFinite(values.totalBudgetPoints) || values.totalBudgetPoints <= 0) {
    errors.totalBudgetPoints = "Set a total budget greater than zero.";
  }

  return errors;
}
