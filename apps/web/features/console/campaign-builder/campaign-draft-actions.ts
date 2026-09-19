import type { CampaignDraft } from "./campaign-draft";
import { draftCompleteQuestionCount, draftDurationSeconds } from "./campaign-draft";
import { canPause, canResume, canSubmitForReview } from "./campaign-draft-status";
import { evaluateBankSize } from "../question-bank/question-bank-rules";

/**
 * Pure campaign-draft workflow transitions, mirroring
 * `features/console/team-actions.ts`'s `{ ok, value } | { ok, error }`
 * shape (docs/13b-typescript-standards.md §4's discipline, without
 * `neverthrow` for the same reason team-actions.ts gives: no live workflow
 * API exists yet, and a value import of it would be Zod-adjacent in a
 * client-reachable module anyway).
 */
export type CampaignDraftActionError =
  | { type: "wrong_status"; status: CampaignDraft["status"] }
  | { type: "no_video" }
  | { type: "bank_too_small"; required: number; actual: number }
  | { type: "no_title" };

export type CampaignDraftActionResult =
  { ok: true; value: CampaignDraft } | { ok: false; error: CampaignDraftActionError };

function withUpdate(draft: CampaignDraft, patch: Partial<CampaignDraft>): CampaignDraft {
  return { ...draft, ...patch, updatedAt: new Date().toISOString() };
}

/**
 * Submits a draft (or a revised rejection) for moderation. Refuses if the
 * video is not ready or the question bank does not yet meet the anti-sharing
 * minimum for this video's length (docs/06 §4.1: "enforced at campaign
 * approval, not suggested") — the UI should never let a business submit
 * something the moderator will just bounce back for the same reason.
 */
export function submitForReview(draft: CampaignDraft): CampaignDraftActionResult {
  if (!canSubmitForReview(draft.status)) {
    return { ok: false, error: { type: "wrong_status", status: draft.status } };
  }
  if (draft.title.trim().length === 0) {
    return { ok: false, error: { type: "no_title" } };
  }
  if (draft.video.status !== "ready") {
    return { ok: false, error: { type: "no_video" } };
  }
  const bankEvaluation = evaluateBankSize(
    draftDurationSeconds(draft),
    draftCompleteQuestionCount(draft),
  );
  if (!bankEvaluation.meetsRequirement) {
    return {
      ok: false,
      error: {
        type: "bank_too_small",
        required: bankEvaluation.requiredBankSize,
        actual: bankEvaluation.actualBankSize,
      },
    };
  }
  return { ok: true, value: withUpdate(draft, { status: "in_review", rejectionReason: null }) };
}

export function pauseCampaign(draft: CampaignDraft): CampaignDraftActionResult {
  if (!canPause(draft.status)) {
    return { ok: false, error: { type: "wrong_status", status: draft.status } };
  }
  return { ok: true, value: withUpdate(draft, { status: "paused" }) };
}

export function resumeCampaign(draft: CampaignDraft): CampaignDraftActionResult {
  if (!canResume(draft.status)) {
    return { ok: false, error: { type: "wrong_status", status: draft.status } };
  }
  return { ok: true, value: withUpdate(draft, { status: "live" }) };
}

/** The one door back to an editable state from `rejected` — docs/tasks/phase-u-ui.md YT-0441 asks for rejection reasons to be visible, and this is what "acting" on one looks like: revise, then resubmit. */
export function reviseRejectedDraft(draft: CampaignDraft): CampaignDraftActionResult {
  if (draft.status !== "rejected") {
    return { ok: false, error: { type: "wrong_status", status: draft.status } };
  }
  return { ok: true, value: withUpdate(draft, { status: "draft" }) };
}

export function campaignDraftActionErrorMessage(error: CampaignDraftActionError): string {
  switch (error.type) {
    case "wrong_status":
      return `This campaign is currently "${error.status}" — this action isn't available from that state.`;
    case "no_video":
      return "Upload and finish processing the video before submitting for review.";
    case "no_title":
      return "Give the campaign a title before submitting for review.";
    case "bank_too_small":
      return `The question bank needs at least ${error.required} complete questions before this campaign can go to review — it currently has ${error.actual}.`;
    default: {
      const exhaustive: never = error;
      throw new Error(`Unhandled campaign draft action error: ${JSON.stringify(exhaustive)}`);
    }
  }
}
