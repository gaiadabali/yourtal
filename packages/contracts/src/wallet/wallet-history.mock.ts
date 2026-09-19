import type { Campaign } from "../campaign/campaign";
import type { Voucher } from "../voucher/voucher";
import type { WalletHistoryEntry } from "./wallet-history";
import { walletHistoryEntrySchema } from "./wallet-history";
import { DEFAULT_REFERENCE_INSTANT, addDays, addHours, toIsoString } from "../internal/clock";
import { pointsPriceFromSettlement, toPoints } from "../money/money";

/**
 * Illustrative mock backing rate (IDR per point), same role as the constant
 * of the same name in `listing.mock.ts` — not the real pricing engine, and
 * NOT the number a real burn entry would carry: a real one is derived from
 * whatever the ledger actually recorded (see `wallet-history.ts`'s header).
 */
const MOCK_BACKING_RATE_IDR_PER_POINT = 6;

/**
 * Derives history entries from mock campaigns and vouchers that already
 * exist, rather than inventing unrelated ids — the same discipline
 * `packages/db`'s seed applies to real Postgres rows (docs/13: "a fixture
 * can describe a world that cannot exist; a database cannot"). One earn
 * entry per campaign, one burn entry per voucher, newest first.
 */
export function generateWalletHistory(
  campaigns: readonly Campaign[],
  vouchers: readonly Voucher[],
): WalletHistoryEntry[] {
  const earned = campaigns.map((campaign) =>
    walletHistoryEntrySchema.parse({
      id: `wh_earn_${campaign.id}`,
      kind: "earn",
      occurredAt: campaign.publishedAt,
      description: `Menyelesaikan video ${campaign.merchantName} — dapat ${String(campaign.rewardPoints)} poin`,
      points: campaign.rewardPoints,
      direction: "credit",
      relatedId: campaign.id,
    }),
  );

  const spent = vouchers.map((voucher) =>
    walletHistoryEntrySchema.parse({
      id: `wh_burn_${voucher.id}`,
      kind: "burn",
      occurredAt: voucher.issuedAt,
      description: `Menukar poin untuk voucher ${voucher.merchantName}`,
      points: pointsPriceFromSettlement(voucher.faceValueIdr, MOCK_BACKING_RATE_IDR_PER_POINT),
      direction: "debit",
      relatedId: voucher.id,
    }),
  );

  return [...earned, ...spent].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
}

/** Points that expired unused — the wallet's "you lost these" state (docs/17 section 3). */
export const expiryHistoryFixture: WalletHistoryEntry = walletHistoryEntrySchema.parse({
  id: "wh_expiry_00000000-0000-4000-8000-000000000601",
  kind: "expiry",
  occurredAt: toIsoString(addDays(DEFAULT_REFERENCE_INSTANT, -2)),
  description: "150 poin kedaluwarsa karena tidak digunakan dalam 90 hari",
  points: toPoints(150),
  direction: "debit",
});

/** A burn reversed after a merchant-side void — points credited back. */
export const reversalHistoryFixture: WalletHistoryEntry = walletHistoryEntrySchema.parse({
  id: "wh_reversal_00000000-0000-4000-8000-000000000602",
  kind: "reversal",
  occurredAt: toIsoString(addHours(DEFAULT_REFERENCE_INSTANT, -6)),
  description: "2.500 poin dikembalikan karena penukaran voucher dibatalkan merchant",
  points: toPoints(2_500),
  direction: "credit",
  relatedId: "00000000-0000-4000-8000-000000000401",
});

/** A support-issued goodwill credit (docs/14 section 5's per-case ceiling). */
export const adjustmentHistoryFixture: WalletHistoryEntry = walletHistoryEntrySchema.parse({
  id: "wh_adjustment_00000000-0000-4000-8000-000000000603",
  kind: "adjustment",
  occurredAt: toIsoString(addDays(DEFAULT_REFERENCE_INSTANT, -1)),
  description: "500 poin goodwill dari tim dukungan atas gangguan layanan",
  points: toPoints(500),
  direction: "credit",
});
