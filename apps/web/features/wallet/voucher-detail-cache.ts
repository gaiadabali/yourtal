/**
 * Local cache for one voucher's detail view — the offline guarantee behind
 * 6.5.b's "voucher is a pass" (usable at the counter with no signal).
 * localStorage is a process boundary (another tab, a stale schema version,
 * a tampered value can all write there), so every read is validated and
 * every access wrapped in try/catch. The guard is hand-written, not Zod
 * (13.4.d, F93): even `zod/mini` kept this route over the 200 KB
 * initial-JS gate (docs/13b-typescript-standards.md §3, §8) — see
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

const STATES = ["reserved", "activated", "released"] as const;
const STATUSES = ["active", "redeemed", "expired", "transferred"] as const;
const CURRENCIES = ["AUD", "IDR"] as const;
const POLICIES = ["balance_carrying", "single_use_forfeit", "minimum_spend"] as const;

export interface CachedVoucherDetail {
  voucherId: string;
  listingId: string;
  state: (typeof STATES)[number];
  /** 11.6.d: the same additive `status` field `wallet-data.ts` now parses — see its doc comment. */
  status?: (typeof STATUSES)[number] | undefined;
  merchantName?: string | undefined;
  title?: string | undefined;
  currency?: (typeof CURRENCIES)[number] | undefined;
  faceValueMinor?: number | undefined;
  remainingValueMinor?: number | undefined;
  partialRedemptionPolicy?: (typeof POLICIES)[number] | undefined;
  issuedAt?: string | undefined;
  expiresAt?: string | undefined;
  location?: { name: string; address: string; district: string } | undefined;
  cachedAt: string;
}

class Invalid extends Error {}

function oneOf<T extends string>(values: readonly T[], value: unknown): T {
  if (typeof value === "string" && (values as readonly string[]).includes(value)) return value as T;
  throw new Invalid();
}
function text(value: unknown, nonEmpty = false): string {
  if (typeof value !== "string" || (nonEmpty && value.length === 0)) throw new Invalid();
  return value;
}
function num(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Invalid();
  return value;
}
function optional<T>(value: unknown, check: (v: unknown) => T): T | undefined {
  return value === undefined ? undefined : check(value);
}

/**
 * The stored value as a `CachedVoucherDetail`, or null; the same checks the
 * old schema made. Unknown keys (a stray `code`) are dropped, never kept.
 */
export function parseCachedVoucherDetail(value: unknown): CachedVoucherDetail | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  try {
    const location = optional(v["location"], (raw) => {
      if (typeof raw !== "object" || raw === null) throw new Invalid();
      const l = raw as Record<string, unknown>;
      return { name: text(l["name"]), address: text(l["address"]), district: text(l["district"]) };
    });
    const detail: CachedVoucherDetail = {
      voucherId: text(v["voucherId"], true),
      listingId: text(v["listingId"], true),
      state: oneOf(STATES, v["state"]),
      cachedAt: text(v["cachedAt"]),
    };
    const optionals = {
      status: optional(v["status"], (raw) => oneOf(STATUSES, raw)),
      merchantName: optional(v["merchantName"], (raw) => text(raw)),
      title: optional(v["title"], (raw) => text(raw)),
      currency: optional(v["currency"], (raw) => oneOf(CURRENCIES, raw)),
      faceValueMinor: optional(v["faceValueMinor"], num),
      remainingValueMinor: optional(v["remainingValueMinor"], num),
      partialRedemptionPolicy: optional(v["partialRedemptionPolicy"], (raw) =>
        oneOf(POLICIES, raw),
      ),
      issuedAt: optional(v["issuedAt"], (raw) => text(raw)),
      expiresAt: optional(v["expiresAt"], (raw) => text(raw)),
      location,
    };
    for (const [key, field] of Object.entries(optionals)) {
      if (field !== undefined) Object.assign(detail, { [key]: field });
    }
    return detail;
  } catch (error) {
    if (error instanceof Invalid) return null;
    throw error;
  }
}

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
  status?: "active" | "redeemed" | "expired" | "transferred" | undefined;
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
  const detail = parseCachedVoucherDetail({ ...voucher, cachedAt });
  if (detail === null) throw new Error("voucher detail failed validation");
  return detail;
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
    return parseCachedVoucherDetail(parsed);
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
