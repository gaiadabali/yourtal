"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import { Card, CardContent } from "@yourtal/ui/card";
import { draftDurationSeconds } from "./campaign-draft";
import type { CampaignDraft } from "./campaign-draft";
import { CampaignDraftStatusBadge } from "./campaign-draft-status-badge";

export interface CampaignDraftListProps {
  drafts: readonly CampaignDraft[];
  onOpen: (draftId: string) => void;
  onCreate: () => void;
  canEdit: boolean;
}

/** The campaign list: one row per draft, its workflow status and — for a rejected one — the reason right there, not hidden behind a click. No local state, rendered inside `campaign-builder-screen.tsx`'s client tree. */
export function CampaignDraftList({ drafts, onOpen, onCreate, canEdit }: CampaignDraftListProps) {
  const t = useTranslations("studio");

  function formatMinutes(durationSeconds: number): string {
    const minutes = Math.round(durationSeconds / 60);
    return minutes <= 0
      ? t("campaignBuilder.list.noVideoYet")
      : t("campaignBuilder.list.minutes", { minutes });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-sans font-semibold text-fg">
          {t("campaignBuilder.list.title")}
        </h2>
        {canEdit ? (
          <Button type="button" onClick={onCreate}>
            {t("campaignBuilder.list.newCampaign")}
          </Button>
        ) : null}
      </div>

      {drafts.length === 0 ? (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-sans text-fg-muted">{t("campaignBuilder.list.empty")}</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {drafts.map((draft) => (
            <li key={draft.id}>
              <Card>
                <CardContent className="flex flex-col gap-2 p-4">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onOpen(draft.id)}
                    className="h-auto justify-start p-0 flex-col items-start gap-1 text-left"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-sans font-semibold text-fg">
                        {draft.title || t("campaignBuilder.list.untitled")}
                      </span>
                      <CampaignDraftStatusBadge status={draft.status} />
                    </div>
                    <p className="text-xs font-sans text-fg-muted">
                      {formatMinutes(draftDurationSeconds(draft))} ·{" "}
                      {t("campaignBuilder.list.rewardPoints", { points: draft.rewardPoints })}
                    </p>
                  </Button>
                  {draft.status === "rejected" && draft.rejectionReason ? (
                    <div className="flex items-start gap-2 rounded-md bg-danger/10 px-3 py-2">
                      <Badge variant="danger" className="shrink-0">
                        {t("campaignBuilder.list.rejected")}
                      </Badge>
                      <p className="text-xs font-sans text-fg-muted">{draft.rejectionReason}</p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
