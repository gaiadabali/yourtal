import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { DataTable } from "@yourtal/ui/data-table";
import { EmptyState } from "@yourtal/ui/empty-state";
import type { StaffDisbursement } from "@yourtal/contracts/billing/payouts";
import { StaffDisbursementActions } from "./staff-disbursement-actions";
import type { EconomyProposal } from "@yourtal/contracts/staff/economy";

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Every failure code the app can show with plain wording: the four the job will not retry itself, then the processor's bank-payout codes. */
const KNOWN_FAILURE_CODES: readonly string[] = [
  "transfer_unconfirmed",
  "payout_unconfirmed",
  "transfer_declined",
  "payout_declined",
  "account_closed",
  "account_frozen",
  "bank_account_restricted",
  "bank_ownership_changed",
  "could_not_process",
  "debit_not_authorized",
  "declined",
  "insufficient_funds",
  "invalid_account_number",
  "incorrect_account_holder_name",
  "invalid_currency",
  "no_account",
  "unsupported_card",
  "payout_failed",
  "canceled",
];

/** One line for an approved payout's disbursement. No row yet means it is still queued. */
export function disbursementLine(
  t: Translate,
  disbursement: StaffDisbursement | undefined,
): string {
  if (disbursement === undefined || disbursement.status === "queued") {
    return t("settlement.disbursement.queued");
  }
  const attempt =
    disbursement.attempt > 1
      ? ` ${t("settlement.disbursement.attempt", { attempt: disbursement.attempt })}`
      : "";
  switch (disbursement.status) {
    case "awaiting_account":
      return t("settlement.disbursement.awaitingAccount") + attempt;
    case "transferred":
      return t("settlement.disbursement.transferred") + attempt;
    case "paid":
      return (
        t("settlement.disbursement.paid", {
          last4: disbursement.bankLast4 ?? "",
          date: disbursement.paidAt === null ? "" : disbursement.paidAt.slice(0, 10),
        }) + attempt
      );
    default: {
      const code = disbursement.failureCode;
      // A code this console has no wording for still shows, so staff can look it up at the processor.
      const why =
        code === null
          ? t("settlement.failureWhy.none")
          : KNOWN_FAILURE_CODES.includes(code)
            ? t(`settlement.failureWhy.${code}`)
            : t("settlement.failureWhy.other", { code });
      return t("settlement.disbursement.failedWhy", { why }) + attempt;
    }
  }
}

/** Approved payout proposals with where each one's money has got to, joined by proposal id. */
export function StaffApprovedPayouts({
  t,
  region,
  proposals,
  disbursements,
  canAct,
  currentStaffId,
}: {
  t: Translate;
  region: "AU" | "ID";
  proposals: readonly EconomyProposal[];
  disbursements: readonly StaffDisbursement[];
  /** Finance: checks and retries move a payout, so they follow the payout approval's role. */
  canAct: boolean;
  currentStaffId: string;
}) {
  const byProposal = new Map(disbursements.map((row) => [row.proposalId, row]));
  const approved = proposals.filter(
    (proposal) => proposal.status === "approved" && proposal.kind === "approve_payout",
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("settlement.approvedTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        {approved.length === 0 ? (
          <EmptyState title={t("settlement.approvedEmptyTitle")} />
        ) : (
          <DataTable
            caption={t("settlement.approvedTitle")}
            rows={approved}
            getRowKey={(row) => row.id}
            columns={[
              { key: "summary", header: t("settlement.columnPayout"), cell: (row) => row.summary },
              {
                key: "disbursement",
                header: t("settlement.columnDisbursement"),
                cell: (row) => disbursementLine(t, byProposal.get(row.id)),
              },
              ...(canAct
                ? [
                    {
                      key: "actions",
                      header: t("settlement.columnActions"),
                      cell: (row: EconomyProposal) => {
                        const disbursement = byProposal.get(row.id);
                        if (disbursement === undefined || !disbursement.needsStaff) return null;
                        return (
                          <StaffDisbursementActions
                            region={region}
                            disbursement={disbursement}
                            payoutLabel={row.summary}
                            currentStaffId={currentStaffId}
                          />
                        );
                      },
                    },
                  ]
                : []),
            ]}
          />
        )}
      </CardContent>
    </Card>
  );
}
