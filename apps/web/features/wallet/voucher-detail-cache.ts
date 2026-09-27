import * as z from "zod/mini";

/**
 * Local cache for one voucher's detail view — the offline guarantee behind
 * 6.5.b's "voucher is a pass" (usable at the counter with no signal).
 * localStorage is a process boundary (another tab, a stale schema version,
 * a tampered value can all write there), so every read is Zod-parsed and
 * every access wrapped in try/catch, and `zod/mini` (not `zod`) keeps this
 * out of the Zod-runtime cost that would otherwise land in the client
 * bundle (docs/13b-typescript-standards.md §3, §8) — see
 * `use-voucher-qr-rotation.ts`'s sibling IndexedDB cache for the QR windows
 * themselves, which live separately because they need a bigger, longer-lived
 * store (6.5.c: an hour of rotating tokens, not one small record).
 *
 * Every field below except `voucherId`/`listingId`/`state` is OPTIONAL,
 * mirroring `wallet-data.ts`'s `walletVoucherDetailSchema` — the live wallet
 * API does not send them yet (see that file's doc comment on why), so a
 * cache entry with them missing is still a valid, useful cache entry: the
 * screen renders a generic placeholder for whichever field it does not
 * have, live or cached alike.
 */
const STORAGE_PREFIX = "yourtal:wallet:voucher:";

const cachedMerchantLocationSchema = z.object({
  name: z.string(),
  address: z.string(),
  district: z.string(),
});

export const cachedVoucherDetailSchema = z.object({
  voucherId: z.string().check(z.minLength(1)),
  listingId: z.string().check(z.minLength(1)),
  state: z.enum(["reserved", "activated", "released"]),
  merchantName: z.optional(z.string()),
  title: z.optional(z.string()),
  currency: z.optional(z.enum(["AUD", "IDR"])),
  faceValueMinor: z.optional(z.number()),
  remainingValueMinor: z.optional(z.number()),
  partialRedemptionPolicy: z.optional(
    z.enum(["balance_carrying", "single_use_forfeit", "minimum_spend"]),
  ),
  issuedAt: z.optional(z.string()),
  expiresAt: z.optional(z.string()),
  location: z.optional(cachedMerchantLocationSchema),
  cachedAt: z.string(),
});

export type CachedVoucherDetail = z.infer<typeof cachedVoucherDetailSchema>;

/**
 * A voucher fresh off the wallet API, minus its redemption `code` — see this
 * file's own doc comment for why `code` never reaches this cache.
 */
export interface VoucherDetailSource {
  voucherId: string;
  listingId: string;
  state: "reserved" | "activated" | "released";
  // `| undefined` rather than a bare `?:` (repo-wide `exactOptionalPropertyTypes`):
  // this type mirrors `WalletVoucherDetail`, whose optional fields come out of a
  // Zod `.optional()` parse as an always-present key that MAY be `undefined`,
  // not an omittable one — the two are different shapes under this flag.
  merchantName?: string | undefined;
  title?: string | undefined;
  currency?: "AUD" | "IDR" | undefined;
  faceValueMinor?: number | undefined;
  remainingValueMinor?: number | undefined;
  partialRedemptionPolicy?: "balance_carrying" | "single_use_forfeit" | "minimum_spend" | undefined;
  issuedAt?: string | undefined;
  expiresAt?: string | undefined;
  location?: { name: string; address: string; district: string } | undefined;
}

/** Builds a valid cache entry from a live voucher read, deliberately dropping any `code`. */
export function buildCachedVoucherDetail(
  voucher: VoucherDetailSource,
  cachedAt: string,
): CachedVoucherDetail {
  return cachedVoucherDetailSchema.parse({ ...voucher, cachedAt });
}

function storageKey(voucherId: string): string {
  return `${STORAGE_PREFIX}${voucherId}`;
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
    window.localStorage.setItem(storageKey(detail.voucherId), JSON.stringify(detail));
  } catch {
    // Private mode, quota exceeded, or storage disabled.
  }
}
