import * as z from "zod";

/**
 * TASKS.md 1.2.c: the one closed error enum `ledger-internal` and
 * `voucher-internal` both return. A closed set rather than a free-text
 * `message` because every caller (apps/api, apps/worker) needs to SWITCH on
 * the failure to decide what a viewer sees — "insufficient available" earns
 * a balance screen, "kill_switch" earns a generic outage message, and a
 * `string` cannot be exhaustively matched.
 */
export const ledgerErrorCodeSchema = z.enum([
  "insufficient_available",
  "quote_expired",
  "allocation_exhausted",
  "campaign_cap_reached",
  "velocity_capped",
  "solvency_blocked",
  "region_mismatch",
  "audience_blocked",
  "already_granted",
  "idempotency_conflict",
  "kill_switch",
  "currency_mismatch",
  /** 10.1.c: `approvePayout` before a statement's F12 dispute window has closed. */
  "dispute_window_open",
  /** 10.1/10.6: an action that needs a statement `open` (approve, dispute) found one disputed or already paid. */
  "statement_not_open",
  /** 13.1.d: the listing has no unallocated voucher left (the voucher service's refusal). */
  "sold_out",
  /**
   * 13.3.j: the ledger refused a request it has no more specific code for (its
   * HTTP 400 `refused`: an attestation that does not verify, a campaign that
   * is not live, points that are not what the terms pay), or answered a
   * refusal code this enum does not know. A caller words it generically.
   */
  "refused",
]);

export type LedgerErrorCode = z.infer<typeof ledgerErrorCodeSchema>;

export const ledgerErrorSchema = z.object({
  code: ledgerErrorCodeSchema,
  message: z.string().min(1),
});

export type LedgerError = z.infer<typeof ledgerErrorSchema>;

export function ledgerError(code: LedgerErrorCode, message: string): LedgerError {
  return { code, message };
}
