/**
 * The ledger has no such record (its 404). Not a refusal a caller words for a
 * viewer, but one it must tell apart from an unreachable ledger: checkout
 * recovery releases a voucher only when the burn is known not to exist.
 */
export class LedgerNotFoundError extends Error {
  override readonly name = "LedgerNotFoundError";
}
