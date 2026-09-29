"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { CampaignModerationQueueItem } from "@yourtal/contracts/staff/moderation";
import { Badge } from "@yourtal/ui/badge";
import { DataTable } from "@yourtal/ui/data-table";
import { EmptyState } from "@yourtal/ui/empty-state";
import { Notice } from "@yourtal/ui/notice";
import { Text } from "@yourtal/ui/text";
import { StaffReasonDialogButton } from "../staff-reason-dialog-button";
import {
  approveCampaignModerationAction,
  rejectCampaignModerationAction,
} from "./staff-campaign-moderation-actions";

export interface StaffCampaignModerationListProps {
  readonly initial: readonly CampaignModerationQueueItem[];
}

/**
 * TASKS.md 9.2.a: the campaign-creative half of `/staff/moderation`. Each
 * row shows the automated screen's flags (question-bank PII/prediction) and
 * the declared audience/category ("confirm or change", 1.1.d) alongside the
 * approve/reject actions -- a decided campaign drops out of the list, same
 * as the voucher-batch queue above it.
 */
export function StaffCampaignModerationList({ initial }: StaffCampaignModerationListProps) {
  const t = useTranslations("staff");
  const [items, setItems] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  async function decide(
    campaignId: string,
    action: (id: string, reason: string) => Promise<{ ok: boolean; error?: { message: string } }>,
    reason: string,
  ): Promise<boolean> {
    const result = await action(campaignId, reason);
    if (result.ok) {
      setItems((current) => current.filter((item) => item.campaign.id !== campaignId));
      setError(null);
      return true;
    }
    setError(result.error?.message ?? t("errors.actionFailed"));
    return false;
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null ? <Notice tone="danger">{error}</Notice> : null}
      {items.length === 0 ? (
        <EmptyState
          title={t("moderation.campaignsEmptyTitle")}
          description={t("moderation.campaignsEmptyDescription")}
        />
      ) : (
        <DataTable
          caption={t("moderation.campaignsTableCaption")}
          columns={[
            {
              key: "title",
              header: t("moderation.columnCampaign"),
              cell: (row) => (
                <div className="flex flex-col gap-0.5">
                  <Text size="label">{row.campaign.title}</Text>
                  <Text size="caption" tone="muted">
                    {row.campaign.audience} · {row.campaign.contentCategory}
                  </Text>
                </div>
              ),
            },
            {
              key: "flags",
              header: t("moderation.columnFlags"),
              cell: (row) =>
                row.flags.length === 0 ? (
                  <Text size="body-sm" tone="muted">
                    {t("moderation.noFlags")}
                  </Text>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {row.flags.map((flag, index) => (
                      <Badge key={`${flag.questionId}-${index}`} variant="danger">
                        {flag.kind === "pii"
                          ? t("moderation.flagPii", { category: flag.category ?? "" })
                          : t("moderation.flagPrediction")}
                      </Badge>
                    ))}
                  </div>
                ),
            },
            {
              key: "actions",
              header: t("moderation.columnActions"),
              cell: (row) => (
                <div className="flex flex-wrap gap-2">
                  <StaffReasonDialogButton
                    triggerLabel={t("moderation.approveCta")}
                    triggerVariant="primary"
                    dialogTitle={t("moderation.approveDialogTitle")}
                    dialogBody={t("moderation.approveCampaignDialogBody")}
                    submitLabel={t("moderation.approveSubmit")}
                    onSubmit={(reason) =>
                      decide(row.campaign.id, approveCampaignModerationAction, reason)
                    }
                  />
                  <StaffReasonDialogButton
                    triggerLabel={t("moderation.rejectCta")}
                    triggerVariant="danger"
                    dialogTitle={t("moderation.rejectDialogTitle")}
                    dialogBody={t("moderation.rejectCampaignDialogBody")}
                    submitLabel={t("moderation.rejectSubmit")}
                    onSubmit={(reason) =>
                      decide(row.campaign.id, rejectCampaignModerationAction, reason)
                    }
                  />
                </div>
              ),
            },
          ]}
          rows={[...items]}
          getRowKey={(row) => row.campaign.id}
        />
      )}
    </div>
  );
}
