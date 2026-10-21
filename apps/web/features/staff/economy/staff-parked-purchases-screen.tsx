"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { DataTable } from "@yourtal/ui/data-table";
import { EmptyState } from "@yourtal/ui/empty-state";
import { Notice } from "@yourtal/ui/notice";
import { formatMoneyAmount } from "@yourtal/ui/money-amount";
import { StatusBadge } from "@yourtal/ui/status-badge";
import { Text } from "@yourtal/ui/text";
import type { ParkedPurchase } from "@yourtal/contracts/staff/parked-purchases";
import { StaffReasonDialogButton } from "../staff-reason-dialog-button";
import {
  decideRefundAction,
  proposeRefundAction,
  type ParkedPurchaseActionResult,
} from "./staff-parked-purchases-actions";

export interface StaffParkedPurchasesScreenProps {
  readonly region: "AU" | "ID";
  readonly purchases: readonly ParkedPurchase[];
  readonly currentStaffId: string;
}

type Flash = { tone: "success" | "danger"; text: string } | null;

function businessLabel(row: ParkedPurchase): string {
  return row.businessName ?? row.businessId;
}

// A fixed zone per region: without one the server formats in its own zone and the browser in the
// visitor's, and React refuses to hydrate the mismatch.
const TIME_ZONE = { AU: "Australia/Sydney", ID: "Asia/Jakarta" } as const;

/** 5.1.g: card purchases that were charged but not turned into points, and the two-person refund of each. */
export function StaffParkedPurchasesScreen({
  region,
  purchases,
  currentStaffId,
}: StaffParkedPurchasesScreenProps) {
  const t = useTranslations("staff");
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const [flash, setFlash] = useState<Flash>(null);
  const [isPending, startTransition] = useTransition();

  const money = (row: ParkedPurchase): string =>
    formatMoneyAmount(row.totalMinor, row.currency, locale);

  const when = (iso: string | null): string =>
    iso === null
      ? "—"
      : format.dateTime(new Date(iso), {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: TIME_ZONE[region],
        });

  const waiting = purchases.filter((row) => row.status === "needs_review");
  const refunded = purchases.filter((row) => row.status === "refunded");

  function settle(result: ParkedPurchaseActionResult, success: string): boolean {
    if (result.ok) {
      setFlash({ tone: "success", text: success });
      router.refresh();
      return true;
    }
    setFlash({
      tone: "danger",
      text: result.message === "" ? t("errors.actionFailed") : result.message,
    });
    return false;
  }

  function decide(row: ParkedPurchase, decision: "approve" | "reject") {
    const proposal = row.proposal;
    if (proposal === null) return;
    startTransition(() => {
      void decideRefundAction(region, proposal.id, decision).then((result) =>
        settle(
          result,
          decision === "approve"
            ? t("parkedPurchases.flash.approved")
            : t("parkedPurchases.flash.rejected"),
        ),
      );
    });
  }

  function action(row: ParkedPurchase) {
    const name = businessLabel(row);
    if (!row.refundable) {
      return (
        <Text size="body-sm" tone="muted">
          {t("parkedPurchases.notRefundable")}
        </Text>
      );
    }
    const proposal = row.proposal;
    if (proposal === null) {
      return (
        <StaffReasonDialogButton
          triggerLabel={t("parkedPurchases.proposeCta")}
          triggerAriaLabel={t("parkedPurchases.proposeCtaFor", { business: name })}
          dialogTitle={t("parkedPurchases.proposeDialogTitle", { business: name })}
          dialogBody={t("parkedPurchases.proposeDialogBody", { amount: money(row) })}
          submitLabel={t("parkedPurchases.proposeSubmit")}
          onSubmit={async (reason) =>
            settle(
              await proposeRefundAction(region, row.purchaseId, reason),
              t("parkedPurchases.flash.proposed"),
            )
          }
        />
      );
    }
    return (
      <div className="flex flex-col items-start gap-2">
        <Text size="body-sm" tone="muted">
          {t("parkedPurchases.proposedBy", {
            staff: row.proposedByEmail ?? t("parkedPurchases.staffUnknown"),
          })}
        </Text>
        {proposal.proposedBy === currentStaffId ? (
          <Text size="body-sm" tone="muted">
            {t("parkedPurchases.awaitingSecondStaff")}
          </Text>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={isPending}
              aria-label={t("parkedPurchases.approveCtaFor", { business: name })}
              onClick={() => decide(row, "approve")}
            >
              {t("parkedPurchases.approveCta")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={isPending}
              aria-label={t("parkedPurchases.rejectCtaFor", { business: name })}
              onClick={() => decide(row, "reject")}
            >
              {t("parkedPurchases.rejectCta")}
            </Button>
          </div>
        )}
      </div>
    );
  }

  const sharedColumns = [
    {
      key: "business",
      header: t("parkedPurchases.columnBusiness"),
      cell: (row: ParkedPurchase) => <span className="break-words">{businessLabel(row)}</span>,
    },
    {
      key: "points",
      header: t("parkedPurchases.columnPoints"),
      cell: (row: ParkedPurchase) => format.number(row.points),
      align: "end" as const,
    },
    {
      key: "amount",
      header: t("parkedPurchases.columnAmount"),
      cell: money,
      align: "end" as const,
    },
    {
      key: "reason",
      header: t("parkedPurchases.columnReason"),
      cell: (row: ParkedPurchase) => <span className="break-words">{row.reason}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Text tone="muted">{t("parkedPurchases.explainer")}</Text>
      {flash === null ? null : <Notice tone={flash.tone}>{flash.text}</Notice>}

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t("parkedPurchases.waitingTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {waiting.length === 0 ? (
            <EmptyState title={t("parkedPurchases.emptyTitle")} />
          ) : (
            <DataTable
              caption={t("parkedPurchases.waitingTitle")}
              rows={[...waiting]}
              getRowKey={(row) => row.purchaseId}
              columns={[
                ...sharedColumns,
                {
                  key: "paidAt",
                  header: t("parkedPurchases.columnPaid"),
                  cell: (row) => when(row.paidAt),
                },
                {
                  key: "status",
                  header: t("parkedPurchases.columnStatus"),
                  cell: () => (
                    <StatusBadge status="warning">
                      {t("parkedPurchases.statusNeedsReview")}
                    </StatusBadge>
                  ),
                },
                { key: "action", header: t("parkedPurchases.columnActions"), cell: action },
              ]}
            />
          )}
        </CardContent>
      </Card>

      {refunded.length === 0 ? null : (
        <Card>
          <CardHeader>
            <CardTitle as="h2">{t("parkedPurchases.refundedTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              caption={t("parkedPurchases.refundedTitle")}
              rows={[...refunded]}
              getRowKey={(row) => row.purchaseId}
              columns={[
                ...sharedColumns,
                {
                  key: "status",
                  header: t("parkedPurchases.columnStatus"),
                  cell: (row) => (
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge status="success">
                        {t("parkedPurchases.statusRefunded")}
                      </StatusBadge>
                      <Text size="body-sm" tone="muted">
                        {row.refundedBy === null
                          ? t("parkedPurchases.refundedAtProcessor", {
                              date: when(row.refundedAt),
                            })
                          : t("parkedPurchases.refundedBy", {
                              date: when(row.refundedAt),
                              staff: row.refundedByEmail ?? t("parkedPurchases.staffUnknown"),
                            })}
                      </Text>
                    </div>
                  ),
                },
              ]}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
