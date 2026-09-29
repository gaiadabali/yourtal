import { Button } from "@yourtal/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { DataTable } from "@yourtal/ui/data-table";
import { EmptyState } from "@yourtal/ui/empty-state";
import { Notice } from "@yourtal/ui/notice";
import { StatusBadge } from "@yourtal/ui/status-badge";
import { Text } from "@yourtal/ui/text";
import { Textarea } from "@yourtal/ui/textarea";
import type { EconomyProposal } from "@yourtal/contracts/staff/economy";
import type { SettlementQueue } from "@yourtal/contracts/staff/settlement";
import {
  approvePayoutAction,
  proposePayoutAction,
  resolveStatementDisputeAction,
} from "./staff-settlement-actions";

export interface StaffSettlementScreenProps {
  readonly t: (key: string, values?: Record<string, string | number>) => string;
  readonly region: "AU" | "ID";
  readonly queue: SettlementQueue;
  readonly payoutProposals: readonly EconomyProposal[];
  readonly canResolveDispute: boolean;
  readonly canProposePayout: boolean;
  readonly currentStaffId: string;
  readonly idempotencyKey: string;
  readonly flash: string | undefined;
}

const FLASH_TONE: Record<string, "success" | "danger" | "warning"> = {
  resolved: "success",
  proposed: "success",
  approved: "success",
  error: "danger",
  invalid: "warning",
};

const STATUS_TONE: Record<
  SettlementQueue["statements"][number]["status"],
  "danger" | "warning" | "success" | "neutral"
> = {
  open: "neutral",
  disputed: "danger",
  paid: "success",
};

function minorToDisplay(minor: number, currency: string): string {
  const major = minor / 100;
  return `${currency} ${major.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** TASKS.md 10.6.a: the weekly-statement queue, statement disputes and payout approval (two-person). */
export function StaffSettlementScreen({
  t,
  region,
  queue,
  payoutProposals,
  canResolveDispute,
  canProposePayout,
  currentStaffId,
  idempotencyKey,
  flash,
}: StaffSettlementScreenProps) {
  // `EconomyProposal` (the wire shape) carries no `payload` field -- the
  // statement id is correlated from `summary`, which `proposePayout` always
  // writes as `Payout for statement ${id}` (staff-settlement.controller.ts).
  const pendingByStatement = new Map<string, EconomyProposal>();
  for (const proposal of payoutProposals) {
    if (proposal.status !== "pending") continue;
    const statementId = /^Payout for statement (.+)$/.exec(proposal.summary)?.[1];
    if (statementId !== undefined) pendingByStatement.set(statementId, proposal);
  }

  return (
    <div className="flex flex-col gap-6">
      {flash === undefined ? null : (
        <Notice tone={FLASH_TONE[flash] ?? "info"}>{t(`settlement.flash.${flash}`)}</Notice>
      )}

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t("settlement.queueTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {queue.statements.length === 0 ? (
            <EmptyState title={t("settlement.queueEmptyTitle")} />
          ) : (
            <DataTable
              caption={t("settlement.queueTitle")}
              rows={[...queue.statements]}
              getRowKey={(row) => row.id}
              columns={[
                {
                  key: "businessId",
                  header: t("settlement.columnBusiness"),
                  cell: (row) => row.businessId,
                },
                {
                  key: "status",
                  header: t("settlement.columnStatus"),
                  cell: (row) => (
                    <StatusBadge status={STATUS_TONE[row.status]}>
                      {t(`settlement.status.${row.status}`)}
                    </StatusBadge>
                  ),
                },
                {
                  key: "closing",
                  header: t("settlement.columnClosing"),
                  cell: (row) => minorToDisplay(row.closingPayableMinor, row.currency),
                },
                {
                  key: "disputeWindow",
                  header: t("settlement.columnDisputeWindow"),
                  cell: (row) => new Date(row.disputeWindowEndsAt).toLocaleDateString(),
                },
                {
                  key: "action",
                  header: t("settlement.columnActions"),
                  cell: (row) => {
                    if (row.status === "disputed") {
                      if (!canResolveDispute) return null;
                      return (
                        <form
                          action={resolveStatementDisputeAction}
                          className="flex flex-col items-start gap-2"
                        >
                          <input type="hidden" name="region" value={region} />
                          <input type="hidden" name="statementId" value={row.id} />
                          <input
                            type="hidden"
                            name="idempotencyKey"
                            value={`${idempotencyKey}:resolve:${row.id}`}
                          />
                          <Textarea
                            name="note"
                            label={t("settlement.resolveNoteLabel")}
                            required
                            className="w-56"
                          />
                          <Button type="submit" size="sm" variant="secondary">
                            {t("settlement.resolveCta")}
                          </Button>
                        </form>
                      );
                    }
                    if (row.status !== "open") return null;

                    const pending = pendingByStatement.get(row.id);
                    if (pending === undefined) {
                      if (!canProposePayout) return null;
                      return (
                        <form action={proposePayoutAction} className="flex flex-col gap-2">
                          <input type="hidden" name="region" value={region} />
                          <input type="hidden" name="statementId" value={row.id} />
                          <input
                            type="hidden"
                            name="idempotencyKey"
                            value={`${idempotencyKey}:propose:${row.id}`}
                          />
                          <Button type="submit" size="sm">
                            {t("settlement.proposePayoutCta")}
                          </Button>
                        </form>
                      );
                    }
                    if (pending.proposedBy === currentStaffId) {
                      return (
                        <Text size="body-sm" tone="muted">
                          {t("settlement.awaitingSecondApprover")}
                        </Text>
                      );
                    }
                    if (!canProposePayout) return null;
                    return (
                      <form action={approvePayoutAction}>
                        <input type="hidden" name="region" value={region} />
                        <input type="hidden" name="proposalId" value={pending.id} />
                        <input
                          type="hidden"
                          name="idempotencyKey"
                          value={`${idempotencyKey}:approve:${pending.id}`}
                        />
                        <Button type="submit" size="sm" variant="primary">
                          {t("settlement.approvePayoutCta")}
                        </Button>
                      </form>
                    );
                  },
                },
              ]}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
