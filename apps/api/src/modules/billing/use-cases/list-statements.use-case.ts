import type { BillingStatement } from "@yourtal/contracts/billing";
import type { Statement } from "@yourtal/contracts/ledger-internal/economy";
import type { ResultAsync } from "neverthrow";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import type { ListStatementsError } from "../billing.errors";
import { wrapLedgerCall } from "../wrap-billing";

/** 10.1.b's `Statement` (ledger-internal) narrowed to the studio's own view. `businessId` is dropped: the route already scopes to one tenant. */
export function toBillingStatement(statement: Statement): BillingStatement {
  return {
    id: statement.id,
    region: statement.region,
    currency: statement.currency,
    periodFrom: statement.periodFrom,
    periodTo: statement.periodTo,
    openingPayableMinor: statement.openingPayableMinor,
    capturesMinor: statement.capturesMinor,
    refundsMinor: statement.refundsMinor,
    recoveriesMinor: statement.recoveriesMinor,
    closingPayableMinor: statement.closingPayableMinor,
    pointPurchasesPoints: statement.pointPurchasesPoints,
    status: statement.status,
    disputeReason: statement.disputeReason,
    disputeWindowEndsAt: statement.disputeWindowEndsAt,
    generatedAt: statement.generatedAt,
    payoutTransferId: statement.payoutTransferId,
  };
}

/** 10.1.b/10.6.b: every statement apps/worker has generated for this business whose period falls inside [from, to). */
export function listStatements(
  ledger: Pick<LedgerInternalClient, "statements">,
  businessId: string,
  from: string,
  to: string,
): ResultAsync<readonly BillingStatement[], ListStatementsError> {
  return wrapLedgerCall(ledger.statements({ businessId, from, to })).map((statements) =>
    statements.map(toBillingStatement),
  );
}
