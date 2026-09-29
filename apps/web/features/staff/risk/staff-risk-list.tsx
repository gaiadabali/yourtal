"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge } from "@yourtal/ui/badge";
import { DataTable } from "@yourtal/ui/data-table";
import { EmptyState } from "@yourtal/ui/empty-state";
import { Notice } from "@yourtal/ui/notice";
import { Text } from "@yourtal/ui/text";
import type { StaffRiskFlag } from "@yourtal/contracts/staff/risk-queue";
import { StaffReasonDialogButton } from "../staff-reason-dialog-button";
import { releaseRiskFlagAction, suspendRiskFlagAction } from "./staff-risk-actions";

export interface StaffRiskListProps {
  readonly initial: readonly StaffRiskFlag[];
}

/**
 * TASKS.md 10.5.a: the manual-review queue from 10.4.b -- why an account was
 * flagged (reason + the RiskGate's own signals), then release it (a false
 * positive) or suspend it into escrow (confirmed), each behind a required
 * reason. A decided flag drops out of the list, same shape the moderation
 * queues use. The trust tier is never shown here -- `StaffRiskFlag` carries
 * no such field; whichever screen wants it is `/staff/users/:userId`.
 */
export function StaffRiskList({ initial }: StaffRiskListProps) {
  const t = useTranslations("staff");
  const [flags, setFlags] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  async function decide(
    flagId: string,
    action: (id: string, reason: string) => Promise<{ ok: boolean; error?: { message: string } }>,
    reason: string,
  ): Promise<boolean> {
    const result = await action(flagId, reason);
    if (result.ok) {
      setFlags((current) => current.filter((flag) => flag.id !== flagId));
      setError(null);
      return true;
    }
    setError(result.error?.message ?? t("errors.actionFailed"));
    return false;
  }

  if (flags.length === 0) {
    return <EmptyState title={t("risk.emptyTitle")} description={t("risk.emptyDescription")} />;
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null ? <Notice tone="danger">{error}</Notice> : null}
      <DataTable
        caption={t("risk.tableCaption")}
        rows={[...flags]}
        getRowKey={(row) => row.id}
        columns={[
          {
            key: "user",
            header: t("risk.columnUser"),
            cell: (row) => (
              <Link href={`/staff/users/${row.userId}`} className="text-accent underline">
                {row.userId}
              </Link>
            ),
          },
          {
            key: "region",
            header: t("risk.columnRegion"),
            cell: (row) => t(`regions.${row.region}`),
          },
          {
            key: "severity",
            header: t("risk.columnSeverity"),
            cell: (row) => (
              <Badge variant={row.severity === "block" ? "danger" : "secondary"}>
                {t(`risk.severity.${row.severity}`)}
              </Badge>
            ),
          },
          {
            key: "why",
            header: t("risk.columnWhy"),
            cell: (row) => (
              <div className="flex flex-col gap-1">
                <Text size="body-sm">{row.reason}</Text>
                {row.signals.length === 0 ? null : (
                  <ul className="flex flex-col gap-0.5">
                    {row.signals.map((signal, index) => (
                      <li key={`${signal.kind}-${index}`}>
                        <Text size="caption" tone="muted">
                          {signal.kind}: {signal.detail}
                        </Text>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ),
          },
          {
            key: "createdAt",
            header: t("risk.columnCreatedAt"),
            cell: (row) => new Date(row.createdAt).toLocaleString(),
          },
          {
            key: "actions",
            header: t("risk.columnActions"),
            cell: (row) => (
              <div className="flex flex-wrap gap-2">
                <StaffReasonDialogButton
                  triggerLabel={t("risk.releaseCta")}
                  dialogTitle={t("risk.releaseDialogTitle")}
                  dialogBody={t("risk.releaseDialogBody")}
                  submitLabel={t("risk.releaseSubmit")}
                  onSubmit={(reason) => decide(row.id, releaseRiskFlagAction, reason)}
                />
                <StaffReasonDialogButton
                  triggerLabel={t("risk.suspendCta")}
                  triggerVariant="danger"
                  dialogTitle={t("risk.suspendDialogTitle")}
                  dialogBody={t("risk.suspendDialogBody")}
                  submitLabel={t("risk.suspendSubmit")}
                  onSubmit={(reason) => decide(row.id, suspendRiskFlagAction, reason)}
                />
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
