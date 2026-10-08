import type { LedgerError, LedgerErrorCode } from "@yourtal/contracts/ledger-internal/ledger-error";

const NOT_FUNDED = "This campaign could not be funded right now.";
const NOT_CONFIRMED = "Your points could not be confirmed right now.";

/**
 * A short, honest, viewer-facing reason for a refused grant. Never the raw
 * ledger code. A `Record` over the closed enum, so a new ledger code without
 * a line here is a compile error rather than a silent default (13.3.j).
 */
const REASON: Record<LedgerErrorCode, string> = {
  allocation_exhausted: "This campaign has run out of funding right now.",
  campaign_cap_reached: "This campaign has run out of funding right now.",
  kill_switch: "Rewards are paused right now.",
  region_mismatch: "This campaign is not available to your account.",
  audience_blocked: "This campaign is not available to your account.",
  currency_mismatch: "This campaign is not available to your account.",
  velocity_capped: "You have reached today's earning limit.",
  solvency_blocked: "Rewards are temporarily unavailable.",
  // The same session was already paid: nothing is owed twice.
  already_granted: "You have already earned points for this video.",
  // The ledger's catch-all (a points mismatch, an attestation that does not verify,
  // a campaign no longer live) and a refusal code this app does not know.
  refused: NOT_CONFIRMED,
  idempotency_conflict: NOT_CONFIRMED,
  // Not reachable from a grant; worded generically rather than left blank.
  insufficient_available: NOT_FUNDED,
  quote_expired: NOT_FUNDED,
  dispute_window_open: NOT_FUNDED,
  statement_not_open: NOT_FUNDED,
  sold_out: NOT_FUNDED,
};

export function describeLedgerRefusal(error: Pick<LedgerError, "code">): string {
  // An own-property check: a code from a newer ledger is not in the table.
  return Object.hasOwn(REASON, error.code) ? REASON[error.code] : NOT_CONFIRMED;
}
