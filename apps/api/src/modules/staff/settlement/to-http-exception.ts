import { BadRequestException, ConflictException } from "@nestjs/common";
import type { HttpException } from "@nestjs/common";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";

/**
 * TASKS.md 10.6.a: maps `LedgerError` for the settlement console's own
 * calls (`statementQueue`, `resolveStatementDispute`, `approvePayout`).
 * `dispute_window_open`/`statement_not_open` are the same 409 the billing
 * controller's `mapBillingErrorToHttpException` already gives a business
 * for its own `disputeStatement` call (10.1.c/10.6.c) -- a state conflict,
 * not a malformed request. A statement id that does not exist at all
 * surfaces as `LedgerNotFoundError` (services/ledger's own 404), handled by
 * the controller directly, not here.
 */
export function mapSettlementErrorToHttpException(error: LedgerError): HttpException {
  switch (error.code) {
    case "dispute_window_open":
    case "statement_not_open":
      return new ConflictException({ code: error.code, message: error.message });
    default:
      return new BadRequestException({ code: error.code, message: error.message });
  }
}
