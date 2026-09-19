/**
 * The campaign builder's own workflow status — a strict superset of
 * `@yourtal/contracts/campaign`'s `campaignStatusSchema` ("active" | "paused"
 * | "ended"), which only models a campaign that has ALREADY published (the
 * Earn board / entry card, YT-0410/0411). This ticket (YT-0441) additionally
 * needs the pre-publish authoring workflow docs/tasks/phase-u-ui.md asks
 * for: "Draft, in-review, live, paused and rejected states ... with
 * rejection reasons." "live" here is what the published contract calls
 * "active" once it exists on the Earn board.
 *
 * This is deliberately NOT added to `packages/contracts` — Phase U is
 * mock/UI-only (docs/tasks/phase-u-ui.md preamble) and this file's shape is
 * client-side authoring state, not a wire contract. Whether the real
 * moderation workflow needs `campaignStatusSchema` extended (or a separate
 * `campaignReviewStatusSchema`) to carry draft/in_review/rejected once a
 * real API exists is flagged for the architect in this ticket's report —
 * that decision is out of scope for a UI-only session.
 */
export const CAMPAIGN_DRAFT_STATUSES = [
  "draft",
  "in_review",
  "live",
  "paused",
  "rejected",
] as const;
export type CampaignDraftStatus = (typeof CAMPAIGN_DRAFT_STATUSES)[number];

export const CAMPAIGN_DRAFT_STATUS_LABELS: Record<CampaignDraftStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  live: "Live",
  paused: "Paused",
  rejected: "Rejected",
};

export type CampaignStatusBadgeVariant = "outline" | "warning" | "success" | "secondary" | "danger";

export const CAMPAIGN_DRAFT_STATUS_BADGE_VARIANT: Record<
  CampaignDraftStatus,
  CampaignStatusBadgeVariant
> = {
  draft: "outline",
  in_review: "warning",
  live: "success",
  paused: "secondary",
  rejected: "danger",
};

/** Only a draft or a rejected campaign (after revision) can have its content edited — everything else is either awaiting a moderator or already making promises to users (YT-0411's "terms shown are the terms honoured"). */
export function isDraftContentEditable(status: CampaignDraftStatus): boolean {
  return status === "draft" || status === "rejected";
}

export function canSubmitForReview(status: CampaignDraftStatus): boolean {
  return status === "draft" || status === "rejected";
}

export function canPause(status: CampaignDraftStatus): boolean {
  return status === "live";
}

export function canResume(status: CampaignDraftStatus): boolean {
  return status === "paused";
}
