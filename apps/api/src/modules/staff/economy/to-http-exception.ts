import { BadRequestException, ConflictException } from "@nestjs/common";
import type { HttpException } from "@nestjs/common";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";

/**
 * TASKS.md 9.5: maps `LedgerError` (the closed enum `ledger-internal`
 * returns, 1.2.c) to an HTTP response for the staff economy console. A
 * smaller set of codes than `billing`'s mapper needs, because most of what
 * this console calls (`proposeRate`, `fundMarketing`, `purchasePoints`) is a
 * staff action, not a consumer-facing purchase — 5xx-worthy codes are not
 * expected here in normal operation, so anything not named below falls back
 * to 400 rather than inventing a meaning for it.
 */
export function mapLedgerErrorToHttpException(error: LedgerError): HttpException {
  switch (error.code) {
    case "already_granted":
      // The fake ledger's own two-person guards (`proposeRate`/`approveRate`,
      // `fundMarketing`) reuse this code for "approver == proposer" -- see
      // `fake-ledger-economy.ts`.
      return new ConflictException({ code: "self_approval", message: error.message });
    case "idempotency_conflict":
      return new ConflictException({ code: error.code, message: error.message });
    case "region_mismatch":
    case "currency_mismatch":
    case "solvency_blocked":
    case "insufficient_available":
    case "quote_expired":
    case "allocation_exhausted":
    case "campaign_cap_reached":
    case "velocity_capped":
    case "audience_blocked":
    case "kill_switch":
    default:
      return new BadRequestException({ code: error.code, message: error.message });
  }
}
