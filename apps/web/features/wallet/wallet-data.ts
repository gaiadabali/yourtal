import { z } from "zod";
import { apiFetch, type ApiResult } from "@/lib/api/api-fetch";
import {
  walletHistoryPageSchema,
  walletSummarySchema,
  type WalletHistoryPage,
  type WalletSummary,
} from "@yourtal/contracts/wallet/wallet";
import type { WalletHistoryEntry } from "@yourtal/contracts/wallet/history";
import { voucherStatusSchema } from "@yourtal/contracts/voucher/voucher";
import type { Region } from "@yourtal/contracts/region";

/**
 * The Wallet's one data-access seam (6.5, replacing Phase U's mock-only
 * `resolveDataSource`). Every read is a real `GET /api/wallet*` round trip
 * through `apiFetch` (1.7.a) — no mock branch, per Phase 6's "Done when:
 * ...with no mock data".
 *
 * `GET /api/wallet` and `GET /api/wallet/history` (4.8.a) already answer
 * exactly what 6.5.a needs (available/pending-with-unlock-dates/expiring,
 * and plain-language-ready history entries), so those two are consumed
 * as-is from `@yourtal/contracts/wallet/wallet`.
 *
 * `GET /api/wallet/vouchers[/:id]` and `/qr` are a different story — see
 * `walletVoucherDetailSchema` below.
 */

// ---------------------------------------------------------------------------
// Vouchers: the live contract is deliberately narrower than 6.5.b needs.
// ---------------------------------------------------------------------------

/**
 * `@yourtal/contracts/wallet/wallet`'s `WalletVoucher` carries only
 * `{ voucherId, listingId, state }` — enough to track a reservation through
 * the burn saga (4.7), nothing to *show* a viewer. Every display field a
 * "voucher is a pass" screen needs — merchant name, title, code, currency,
 * remaining value, expiry, redeeming branch — already exists one layer
 * down: `voucher.vouchers` in `services/voucher/db/schema.sql` has every one
 * of these columns, and `GetOwnedVoucher` (`services/voucher/db/query/issue.sql`)
 * already selects them all. The gap is purely in the HTTP contract: the Go
 * handlers `get`/`listForUser` (`services/voucher/internal/api/wallet_routes.go`)
 * narrow every row down to `reservationView` before it reaches
 * apps/api, and `contractState` collapses active/held/redeemed/expired/voided
 * into one bucket — the handler's own comment says as much: "the wallet's
 * own listing endpoint is where redeemed/held/expired/voided vouchers
 * surface their real state via a wider read."
 *
 * Per TASKS.md's rule for needing something another area owns: this schema
 * is written as the WIDENED shape 6.5.b needs, with every field beyond the
 * live `WalletVoucher` marked optional, so `apiFetch`'s `safeParse` accepts
 * today's narrower response cleanly (every extra field parses as
 * `undefined`) and the UI degrades to a generic placeholder for each missing
 * field (see `wallet-voucher-card.tsx` / `voucher-detail-view.tsx`). The day
 * apps/api's wallet routes (Area A) return the wider row, this file and its
 * schema need no change — every field just stops being `undefined`. See
 * TASKS.md 4.8's "(requested by B)" subtask for the exact widening asked
 * for, including the QR's 12 five-minute windows below.
 */
const merchantLocationDisplaySchema = z.object({
  name: z.string(),
  address: z.string(),
  district: z.string(),
});

export const walletVoucherDetailSchema = z.object({
  voucherId: z.uuid(),
  listingId: z.uuid(),
  state: z.enum(["reserved", "activated", "released"]),
  /**
   * 11.6.d (from 4.8.c, merged on main): the voucher's REAL lifecycle —
   * active/redeemed/expired/transferred — derived server-side by
   * `publicVoucherStatusOf`. `state` above stays untouched for
   * back-compat; every classification in `wallet-voucher-status-copy.ts`
   * now prefers this field and falls back to `state` only when a response
   * predates 4.8.c (optional, so both parse).
   */
  status: voucherStatusSchema.optional(),
  merchantName: z.string().optional(),
  title: z.string().optional(),
  /** Never cached (docs/15 rule 7: a plaintext redemption code is never persisted client-side) — see `voucher-detail-cache.ts`. */
  code: z.string().optional(),
  currency: z.enum(["AUD", "IDR"]).optional(),
  faceValueMinor: z.number().optional(),
  remainingValueMinor: z.number().optional(),
  partialRedemptionPolicy: z
    .enum(["balance_carrying", "single_use_forfeit", "minimum_spend"])
    .optional(),
  issuedAt: z.iso.datetime().optional(),
  expiresAt: z.iso.datetime().optional(),
  location: merchantLocationDisplaySchema.optional(),
});
export type WalletVoucherDetail = z.infer<typeof walletVoucherDetailSchema>;

const walletVoucherDetailPageSchema = z.object({
  vouchers: z.array(walletVoucherDetailSchema),
  hasMore: z.boolean(),
});

/**
 * Same story as the voucher schema above: the live `QrToken`/`WalletQr`
 * shape is `{ voucherId, token, expiresAt }` — one window. The Go service
 * behind it already mints and returns twelve consecutive 5-minute-window
 * tokens (`services/voucher/internal/api/wallet_routes.go`'s `qrTokenView.Tokens`,
 * `qrtoken.Mint`) — `HttpVoucherClient` and `WalletController.qr` just pick
 * `tokens[0]` today. `tokens` here is that same widening, optional so this
 * parses cleanly against the live response either way; when absent, the
 * caller falls back to the one token it did get (see
 * `use-voucher-qr-rotation.ts`).
 */
const walletQrDetailSchema = z.object({
  voucherId: z.uuid(),
  token: z.string().min(1),
  expiresAt: z.iso.datetime(),
  tokens: z.array(z.object({ token: z.string().min(1), expiresAt: z.iso.datetime() })).optional(),
});
export type WalletQrDetail = z.infer<typeof walletQrDetailSchema>;

/** The signed-in user's wallet balance: available, pending (per grant, each with its own unlock date) and expiring. */
export function getWalletBalance(): Promise<ApiResult<WalletSummary>> {
  return apiFetch("/api/wallet", walletSummarySchema);
}

/** Points history, newest first; pass a cursor from a previous page's `nextCursor` to paginate. */
export function listWalletHistory(startingAfter?: string): Promise<ApiResult<WalletHistoryPage>> {
  const query = startingAfter ? `?startingAfter=${encodeURIComponent(startingAfter)}` : "";
  return apiFetch(`/api/wallet/history${query}`, walletHistoryPageSchema);
}

// F16: one clock per region decides what "today" is -- same table
// `feed-data.ts` used to keep a private copy of before this moved here.
const REGION_TIME_ZONE: Record<Region, string> = {
  AU: "Australia/Sydney",
  ID: "Asia/Jakarta",
};
const HISTORY_PAGES_FOR_TODAY = 5;

function dayIn(timeZone: string, instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(instant);
}

/**
 * Sums today's `earn` entries in the region's own calendar day (F16) by
 * paging `/api/wallet/history` until it reaches yesterday. Shared by the
 * feed's "earned today" line (11.4) and 12.2.b's teen daily-cap meter, so
 * both read the exact same number rather than two call sites each summing
 * history their own way.
 */
export async function earnedToday(region: Region): Promise<number> {
  const timeZone = REGION_TIME_ZONE[region];
  const today = dayIn(timeZone, new Date());
  let total = 0;
  let cursor: string | undefined;
  for (let page = 0; page < HISTORY_PAGES_FOR_TODAY; page++) {
    const result = await listWalletHistory(cursor);
    if (!result.ok) return total;
    let reachedYesterday = false;
    for (const entry of result.data.entries as readonly WalletHistoryEntry[]) {
      if (dayIn(timeZone, new Date(entry.occurredAt)) !== today) {
        reachedYesterday = true;
        break;
      }
      if (entry.kind === "earn") total += entry.points;
    }
    if (reachedYesterday || result.data.nextCursor === null) return total;
    cursor = result.data.nextCursor;
  }
  return total;
}

/** Every voucher the user holds. */
export function listWalletVouchers(): Promise<
  ApiResult<{ vouchers: WalletVoucherDetail[]; hasMore: boolean }>
> {
  return apiFetch("/api/wallet/vouchers", walletVoucherDetailPageSchema);
}

/** A single voucher for the detail screen. */
export function getWalletVoucher(voucherId: string): Promise<ApiResult<WalletVoucherDetail>> {
  return apiFetch(`/api/wallet/vouchers/${voucherId}`, walletVoucherDetailSchema);
}

/** A fresh QR token (or, once Area A widens it, all twelve of this window's tokens) for showing the voucher at the counter. */
export function getWalletVoucherQr(voucherId: string): Promise<ApiResult<WalletQrDetail>> {
  return apiFetch(`/api/wallet/vouchers/${voucherId}/qr`, walletQrDetailSchema);
}
