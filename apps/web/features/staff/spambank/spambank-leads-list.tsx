"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@yourtal/ui/badge";
import { DataTable } from "@yourtal/ui/data-table";
import type { DataTableColumn } from "@yourtal/ui/data-table";
import { EmptyState } from "@yourtal/ui/empty-state";
import { StatusBadge } from "@yourtal/ui/status-badge";
import { Text } from "@yourtal/ui/text";
import type { Region } from "@yourtal/contracts/region";
import { useStaffTime } from "../staff-time";
import { SpambankLeadEditButton } from "./spambank-lead-edit-button";
import type { LeadStatus, SpambankLead } from "./spambank-staff-contract";

export interface SpambankLeadsListProps {
  readonly initial: readonly SpambankLead[];
  readonly region: Region;
  /** `ops` may change a lead; `support` reads only. A courtesy -- the API's Cerbos check is the rule. */
  readonly canEdit: boolean;
}

const STATUS_TONE = {
  new: "info",
  contacted: "warning",
  ignored: "neutral",
  customer: "success",
} as const;

/** BUILD.md 4.7: the brands that mailed Spambank users, one row each, with the sales team's own status and note. */
export function SpambankLeadsList({ initial, region, canEdit }: SpambankLeadsListProps) {
  const t = useTranslations("staff.spambank.leads");
  const when = useStaffTime();
  const [leads, setLeads] = useState(initial);

  function applySaved(orgDomain: string, status: LeadStatus, note: string | null) {
    setLeads((current) =>
      current.map((lead) => (lead.orgDomain === orgDomain ? { ...lead, status, note } : lead)),
    );
  }

  if (leads.length === 0) {
    return <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />;
  }

  const columns: DataTableColumn<SpambankLead>[] = [
    {
      key: "brand",
      header: t("columnBrand"),
      cell: (row) => (
        <div className="flex min-w-40 flex-col gap-0.5">
          <Text size="body-sm" className="font-medium [overflow-wrap:anywhere]">
            {row.displayName ?? row.orgDomain}
          </Text>
          {row.displayName === null ? null : (
            <Text size="caption" tone="muted" className="[overflow-wrap:anywhere]">
              {row.orgDomain}
            </Text>
          )}
          {row.sampleFrom === null ? null : (
            <Text size="caption" tone="muted" className="[overflow-wrap:anywhere]">
              {row.sampleFrom}
            </Text>
          )}
        </div>
      ),
    },
    {
      key: "subject",
      header: t("columnSubject"),
      cell: (row) => (
        <Text size="body-sm" className="break-words">
          {row.sampleSubject ?? t("none")}
        </Text>
      ),
    },
    {
      key: "reach",
      header: t("columnReach"),
      cell: (row) => (
        <div className="flex flex-col gap-0.5">
          <Text size="caption">{t("reachPeople", { count: row.recipients })}</Text>
          <Text size="caption" tone="muted">
            {t("reachMessages", { count: row.messages })}
          </Text>
        </div>
      ),
    },
    {
      key: "seen",
      header: t("columnSeen"),
      cell: (row) => (
        <div className="flex flex-col gap-0.5">
          <Text size="caption">
            {t("firstSeen", { date: when(row.firstSeenAt, region, "date") })}
          </Text>
          <Text size="caption" tone="muted">
            {t("lastSeen", { date: when(row.lastSeenAt, region, "date") })}
          </Text>
        </div>
      ),
    },
    {
      key: "reply",
      header: t("columnReply"),
      cell: (row) => (
        <div className="flex flex-col items-start gap-1">
          <Text size="caption">
            {row.autoRepliedAt === null
              ? t("notReplied")
              : t("repliedOn", { date: when(row.autoRepliedAt, region, "date") })}
          </Text>
          {row.optedOutAt === null ? null : (
            <Badge variant="outline">
              {t("optedOut", { date: when(row.optedOutAt, region, "date") })}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: t("columnStatus"),
      cell: (row) => (
        <StatusBadge status={STATUS_TONE[row.status]}>{t(`status.${row.status}`)}</StatusBadge>
      ),
    },
    {
      key: "note",
      header: t("columnNote"),
      cell: (row) => (
        <Text size="body-sm" tone={row.note === null ? "muted" : "default"} className="break-words">
          {row.note ?? t("none")}
        </Text>
      ),
    },
  ];
  if (canEdit) {
    columns.push({
      key: "actions",
      header: t("columnActions"),
      cell: (row) => <SpambankLeadEditButton lead={row} onSaved={applySaved} />,
    });
  }

  return (
    <DataTable
      caption={t("tableCaption", { region: t(`regionName.${region}`) })}
      rows={[...leads]}
      getRowKey={(row) => row.orgDomain}
      columns={columns}
    />
  );
}
