import type { Region } from "@yourtal/contracts/region";
import type { LedgerBalance, LedgerHistoryEntry } from "@yourtal/contracts/ledger-internal/wallet";
import type { WalletVoucherRow } from "@yourtal/contracts/voucher-internal/wallet";
import type { WalletSummary, WalletVoucher } from "@yourtal/contracts/wallet/wallet";
import type { WalletHistoryEntry } from "@yourtal/contracts/wallet/history";
import { toPoints } from "@yourtal/contracts/money";
import { publicVoucherStatusOf } from "@yourtal/contracts/voucher/voucher-lifecycle";

/**
 * The ledger's balance as the viewer reads it: pending summed, soonest
 * unlock first. `dailyCapPoints` (12.2.b) is the caller's own concern to
 * supply — this function has no principal or settings reader of its own —
 * omitted entirely (not sent as `undefined`) when the caller has none to
 * give, e.g. an adult viewer.
 */
export function toWalletSummary(
  region: Region,
  balance: LedgerBalance,
  dailyCapPoints?: number,
): WalletSummary {
  const pending = [...balance.pending].sort((a, b) => a.unlockAt.localeCompare(b.unlockAt));
  return {
    region,
    availablePoints: balance.availablePoints,
    pendingPoints: toPoints(pending.reduce((sum, bucket) => sum + bucket.points, 0)),
    pending,
    expiringPoints: balance.expiringPoints,
    expiringAt: balance.expiringAt,
    ...(dailyCapPoints === undefined ? {} : { dailyCapPoints: toPoints(dailyCapPoints) }),
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

/**
 * A held voucher without the saga id, which is the checkout's, not the
 * viewer's. TASKS.md 4.8.c: `state` stays the original three-bucket
 * collapse `services/voucher` already sends (untouched, back-compat with
 * `apps/web/features/wallet/wallet-data.ts`'s own non-optional enum);
 * `status` is the new, additive real state, derived the same way
 * `voucherSchema.status` is everywhere else in this codebase —
 * `publicVoucherStatusOf` is what decides a hold still reads as `active`
 * and a non-transfer void has no public status at all (omitted, not sent
 * as `null`: `exactOptionalPropertyTypes`).
 */
export function toWalletVoucher(row: WalletVoucherRow): WalletVoucher {
  const status = publicVoucherStatusOf(row.lifecycleState, row.voidReason);
  return {
    voucherId: row.voucherId,
    listingId: row.listingId,
    state: row.state,
    ...(status === undefined ? {} : { status }),
    merchantName: row.merchantName,
    title: row.title,
    currency: row.currency,
    faceValueMinor: row.faceValueMinor,
    remainingValueMinor: row.remainingValueMinor,
    expiresAt: row.expiresAt,
    ...(row.location === null ? {} : { location: row.location }),
    partialRedemptionPolicy: row.partialRedemptionPolicy,
    ...(row.giftable === undefined ? {} : { giftable: row.giftable }),
  };
}
