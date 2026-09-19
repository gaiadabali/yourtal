import * as z from "zod/mini";
import type { Voucher } from "@yourtal/contracts/voucher";

/**
 * Local cache for one voucher's detail view — the offline guarantee behind
 * YT-0424's "renders from cache with the network disabled". Same shape and
 * reasoning as apps/web/features/player/resume-position.ts: localStorage is
 * a process boundary (another tab, a stale schema version, a tampered
 * value can all write there), so every read is Zod-parsed and every access
 * wrapped in try/catch, and `zod/mini` (not `zod`) keeps this out of the
 * ~96 KB gz full-Zod cost that would otherwise land in the client bundle
 * (docs/13b-typescript-standards.md §3, §8).
 *
 * IMPORTANT — what this proves and what it does not: this cache is what
 * lets `voucher-detail-view.tsx` render a voucher's data, QR payload and
 * redemption instructions with zero network calls once its JS and this
 * entry are in memory (see that file's test for the proof). It does NOT
 * make the voucher detail PAGE loadable with the network fully off — the
 * HTML/JS shell itself still needs a network fetch (or a service worker
 * intercepting it) to arrive in the first place. That full offline
 * guarantee needs Serwist (docs/15-stack-locked.md), which is not
 * installed in this ticket.
 */
const STORAGE_PREFIX = "yourtal:wallet:voucher:";

const partialRedemptionPolicyValues = ["balance_carrying", "single_use_forfeit", "minimum_spend"] as const;
const voucherStatusValues = ["active", "redeemed", "expired", "transferred"] as const;

export const cachedVoucherDetailSchema = z.object({
  id: z.string().check(z.minLength(1)),
  code: z.string().check(z.minLength(1)),
  merchantName: z.string().check(z.minLength(1)),
  title: z.string().check(z.minLength(1)),
  faceValueIdr: z.number().check(z.minimum(0)),
  remainingValueIdr: z.number().check(z.minimum(0)),
  partialRedemptionPolicy: z.enum(partialRedemptionPolicyValues),
  transferable: z.boolean(),
  status: z.enum(voucherStatusValues),
  issuedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  redemptionInstructions: z.string().check(z.minLength(1)),
  cachedAt: z.iso.datetime(),
});

export type CachedVoucherDetail = z.infer<typeof cachedVoucherDetailSchema>;

function storageKey(voucherId: string): string {
  return `${STORAGE_PREFIX}${voucherId}`;
}

/**
 * Builds a valid cache entry from a schema-validated `Voucher` plus its
 * redemption copy. The input is already trusted (it came straight off the
 * server-parsed contract type), but running it through `.parse` here is a
 * free safety net against a mapping mistake in this function itself.
 */
export function buildCachedVoucherDetail(voucher: Voucher, redemptionInstructions: string, cachedAt: string): CachedVoucherDetail {
  return cachedVoucherDetailSchema.parse({
    id: voucher.id,
    code: voucher.code,
    merchantName: voucher.merchantName,
    title: voucher.title,
    faceValueIdr: voucher.faceValueIdr,
    remainingValueIdr: voucher.remainingValueIdr,
    partialRedemptionPolicy: voucher.partialRedemptionPolicy,
    transferable: voucher.transferable,
    status: voucher.status,
    issuedAt: voucher.issuedAt,
    expiresAt: voucher.expiresAt,
    redemptionInstructions,
    cachedAt,
  });
}

/** Reads a cached voucher detail for `voucherId`, or null if there is none or it fails to validate. Never throws. */
export function readVoucherDetailCache(voucherId: string): CachedVoucherDetail | null {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    const raw = window.localStorage.getItem(storageKey(voucherId));
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    const result = cachedVoucherDetailSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Best-effort write-through. A failed write must never break rendering — same contract as resume-position.ts. */
export function writeVoucherDetailCache(detail: CachedVoucherDetail): void {
  try {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(storageKey(detail.id), JSON.stringify(detail));
  } catch {
    // Private mode, quota exceeded, or storage disabled.
  }
}
