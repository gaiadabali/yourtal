"use client";

import { useState } from "react";
import { Button } from "@yourtal/ui/button";
import { Card, CardContent } from "@yourtal/ui/card";
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
  canEdit: boolean;
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
  canEdit,
}: CampaignEditorStatusPanelProps) {
  const [error, setError] = useState<CampaignDraftActionError | null>(null);

  function run(action: (draft: CampaignDraft) => ReturnType<typeof submitForReview>) {
    const result = action(draft);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    onChange(result.value);
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-sans font-medium text-fg">Status</span>
          <CampaignDraftStatusBadge status={draft.status} />
        </div>

        {draft.status === "rejected" && draft.rejectionReason ? (
          <p className="text-xs font-sans text-fg-muted">
            <span className="font-medium text-fg">Moderator feedback:</span> {draft.rejectionReason}
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="text-xs font-sans text-danger">
            {campaignDraftActionErrorMessage(error)}
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
                Revise
              </Button>
            ) : null}
            {canSubmitForReview(draft.status) ? (
              <Button type="button" size="sm" onClick={() => run(submitForReview)}>
                Submit for review
              </Button>
            ) : null}
            {canPause(draft.status) ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => run(pauseCampaign)}
              >
                Pause
              </Button>
            ) : null}
            {canResume(draft.status) ? (
              <Button type="button" size="sm" onClick={() => run(resumeCampaign)}>
                Resume
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
