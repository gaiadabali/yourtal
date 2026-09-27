import type { WalletHistoryEntryKind } from "@yourtal/contracts/wallet/history";
import type { Translator } from "./wallet-voucher-status-copy";

/**
 * Plain-language wallet history (docs/17 §3: "never TXN_CREDIT_CAMPAIGN_4471").
 *
 * `packages/contracts/src/wallet/wallet-history.ts`'s own doc comment says
 * it plainly: the live `GET /api/wallet/history` omits `description` on
 * purpose — the web words each entry from `kind` alone, in its own
 * catalogues, rather than the ledger recomputing a voucher's points cost
 * from a mock backing rate that has no relationship to what the ledger
 * actually recorded (4.9.d: B never reaches a browser). This file is that
 * wording; the old `wallet-history.ts` it replaces (deleted, 6.5) built its
 * "spent" line from `pointsPriceFromSettlement(..., MOCK_BACKING_RATE_IDR_PER_POINT)`
 * client-side, which is exactly the thing 4.9.d forbids.
 */
const HISTORY_MESSAGE_KEY: Record<WalletHistoryEntryKind, string> = {
  earn: "history.earned",
  burn: "history.spent",
  expiry: "history.expired",
  reversal: "history.reversed",
  adjustment: "history.adjusted",
};

/** One line of plain-language history copy for an entry, from its `kind` and formatted points amount only — no merchant name, no ledger reference. */
export function describeHistoryEntry(
  kind: WalletHistoryEntryKind,
  formattedAmount: string,
  t: Translator,
): string {
  return t(HISTORY_MESSAGE_KEY[kind], { amount: formattedAmount });
}
