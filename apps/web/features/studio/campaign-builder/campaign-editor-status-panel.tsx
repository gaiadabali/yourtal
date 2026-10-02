"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import { Card, CardContent } from "@yourtal/ui/card";
import { submitCampaignDraftLive } from "./campaign-builder-actions";
import {
  campaignDraftActionErrorMessage,
  pauseCampaign,
  resumeCampaign,
  reviseRejectedDraft,
  submitForReview,
} from "./campaign-draft-actions";
import type { CampaignDraftActionError } from "./campaign-draft-actions";
import type { CampaignDraft } from "./campaign-draft";
import { CampaignDraftStatusBadge } from "./campaign-draft-status-badge";
import { canPause, canResume, canSubmitForReview } from "./campaign-draft-status";

export interface CampaignEditorStatusPanelProps {
  draft: CampaignDraft;
  onChange: (draft: CampaignDraft) => void;
  /** Saves unsaved details before submitting (13.3.b: they used to be lost). */
  onSave?: () => Promise<string | null>;
  canEdit: boolean;
  /** 7.3.d/red line 7: submitting is refused server-side while the business is not KYB-verified. This panel blocks the button for the same reason, rather than only finding out from a rejected request. */
  isVerified: boolean;
  /** `YOURTAL_DATA_SOURCE === "live"` — submit calls the real `POST .../submit` (7.3.d) rather than the mock's local transition. */
  isLiveMode: boolean;
  businessId: string;
  campaignId: string;
  merchantName: string;
}

/**
 * Status and the workflow actions available from it (docs/tasks/phase-u-ui.md
 * YT-0441: "Draft, in-review, live, paused and rejected states designed,
 * with rejection reasons"). The rejection reason is shown here in full,
 * not truncated — a moderator's feedback is the only thing telling the
 * business what to fix.
 */
export function CampaignEditorStatusPanel({
  draft,
  onChange,
  onSave,
  canEdit,
  isVerified,
  isLiveMode,
  businessId,
  campaignId,
  merchantName,
}: CampaignEditorStatusPanelProps) {
  const t = useTranslations("studio");
  const [error, setError] = useState<CampaignDraftActionError | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function run(action: (draft: CampaignDraft) => ReturnType<typeof submitForReview>) {
    const result = action(draft);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    onChange(result.value);
  }

  /** 7.3.d, wired for real (was left unwired -- see campaign-builder-actions.ts's own note). */
  async function submitLive() {
    setLiveError(null);
    setSubmitting(true);
    const saveError = onSave ? await onSave() : null;
    if (saveError !== null) {
      setSubmitting(false);
      setLiveError(saveError);
      return;
    }
    const result = await submitCampaignDraftLive(businessId, campaignId, merchantName);
    setSubmitting(false);
    if (!result.ok) {
      setLiveError(result.message);
      return;
    }
    // The submit response has no reward config, question bank or upload state.
    onChange({
      ...result.value,
      allocationId: draft.allocationId,
      accuracyBonusPoints: draft.accuracyBonusPoints,
      rewardValueMinorUnits: draft.rewardValueMinorUnits,
      rewardCurrency: draft.rewardCurrency,
      questionBank: draft.questionBank,
      video: draft.video,
    });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-sans font-medium text-fg">
            {t("campaignBuilder.status.statusLabel")}
          </span>
          <CampaignDraftStatusBadge status={draft.status} />
        </div>

        {draft.status === "rejected" && draft.rejectionReason ? (
          <p className="text-xs font-sans text-fg-muted">
            <span className="font-medium text-fg">
              {t("campaignBuilder.status.moderatorFeedback")}
            </span>{" "}
            {draft.rejectionReason}
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="text-xs font-sans text-danger">
            {campaignDraftActionErrorMessage(error)}
          </p>
        ) : null}

        {liveError ? (
          <p role="alert" className="text-xs font-sans text-danger">
            {liveError}
          </p>
        ) : null}

        {!isVerified && canSubmitForReview(draft.status) ? (
          <p className="text-xs font-sans text-fg-muted">
            {t("campaignBuilder.status.verifyBeforeSubmit")}
          </p>
        ) : null}

        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            {draft.status === "rejected" ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => run(reviseRejectedDraft)}
              >
                {t("campaignBuilder.status.revise")}
              </Button>
            ) : null}
            {canSubmitForReview(draft.status) ? (
              <Button
                type="button"
                size="sm"
                disabled={!isVerified || submitting}
                loading={submitting}
                title={isVerified ? undefined : t("campaignBuilder.status.verifyBeforeSubmitTitle")}
                onClick={() => (isLiveMode ? void submitLive() : run(submitForReview))}
              >
                {t("campaignBuilder.status.submitForReview")}
              </Button>
            ) : null}
            {canPause(draft.status) ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => run(pauseCampaign)}
              >
                {t("campaignBuilder.status.pause")}
              </Button>
            ) : null}
            {canResume(draft.status) ? (
              <Button type="button" size="sm" onClick={() => run(resumeCampaign)}>
                {t("campaignBuilder.status.resume")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
