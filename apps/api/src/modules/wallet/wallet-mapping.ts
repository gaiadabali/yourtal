import type { Region } from "@yourtal/contracts/region";
import type { LedgerBalance, LedgerHistoryEntry } from "@yourtal/contracts/ledger-internal/wallet";
import type { Reservation } from "@yourtal/contracts/voucher-internal/lifecycle";
import type { WalletSummary, WalletVoucher } from "@yourtal/contracts/wallet/wallet";
import type { WalletHistoryEntry } from "@yourtal/contracts/wallet/history";
import { toPoints } from "@yourtal/contracts/money";

/** The ledger's balance as the viewer reads it: pending summed, soonest unlock first. */
export function toWalletSummary(region: Region, balance: LedgerBalance): WalletSummary {
  const pending = [...balance.pending].sort((a, b) => a.unlockAt.localeCompare(b.unlockAt));
  return {
    region,
    availablePoints: balance.availablePoints,
    pendingPoints: toPoints(pending.reduce((sum, bucket) => sum + bucket.points, 0)),
    pending,
    expiringPoints: balance.expiringPoints,
    expiringAt: balance.expiringAt,
  };
}

const KIND: Record<LedgerHistoryEntry["kind"], Pick<WalletHistoryEntry, "kind" | "direction">> = {
  grant: { kind: "earn", direction: "credit" },
  burn: { kind: "burn", direction: "debit" },
  expiry: { kind: "expiry", direction: "debit" },
  reinstatement: { kind: "reversal", direction: "credit" },
  escrow: { kind: "adjustment", direction: "debit" },
  escrow_release: { kind: "adjustment", direction: "credit" },
};

/**
 * No prose and no ledger codes: the web words each entry from `kind` and
 * `relatedId` in its own catalogues. `externalRef` stays server side (it is
 * a support handle, not something a viewer reads).
 */
export function toWalletHistoryEntry(entry: LedgerHistoryEntry): WalletHistoryEntry {
  const relatedId = entry.voucherId ?? entry.listingId ?? entry.campaignId;
  return {
    id: entry.id,
    ...KIND[entry.kind],
    occurredAt: entry.at,
    points: entry.points,
    ...(relatedId === null ? {} : { relatedId }),
  };
}

/** A held voucher without the saga id, which is the checkout's, not the viewer's. */
export function toWalletVoucher(reservation: Reservation): WalletVoucher {
  return {
    voucherId: reservation.voucherId,
    listingId: reservation.listingId,
    state: reservation.state,
  };
}
