import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { DataTable } from "@yourtal/ui/data-table";
import { EmptyState } from "@yourtal/ui/empty-state";
import type { StaffDisbursement } from "@yourtal/contracts/billing/payouts";
import type { EconomyProposal } from "@yourtal/contracts/staff/economy";

type Translate = (key: string, values?: Record<string, string | number>) => string;

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
    default:
      return (
        t("settlement.disbursement.failed", { code: disbursement.failureCode ?? "unknown" }) +
        attempt
      );
  }
}

/** Approved payout proposals with where each one's money has got to, joined by proposal id. */
export function StaffApprovedPayouts({
  t,
  proposals,
  disbursements,
}: {
  t: Translate;
  proposals: readonly EconomyProposal[];
  disbursements: readonly StaffDisbursement[];
}) {
  const byProposal = new Map(disbursements.map((row) => [row.proposalId, row]));
  const approved = proposals.filter((proposal) => proposal.status === "approved");
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
            ]}
          />
        )}
      </CardContent>
    </Card>
  );
}
