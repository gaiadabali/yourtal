import * as z from "zod/mini";

/**
 * The device's local "today" log — today's redemptions with a running
 * total (this ticket's fourth acceptance criterion), the offline queue
 * (third criterion), AND the per-voucher ledger that stops the same
 * voucher being redeemed twice in a row before its first capture
 * round-trips, all in one persisted list. One entry per attempted
 * redemption; `status` is the honest, current truth of that attempt.
 *
 * Persisted to `localStorage`, scoped by device id and calendar day
 * (`policies/resource_policies/redemption.yaml`'s `counter-device-sees-
 * today-only` rule: a counter device's `view_log` is allowed only for
 * `logScope == "today"` — this mirrors that boundary in the mock/offline
 * layer too, not just in the future real authorization check). Same
 * localStorage-as-a-process-boundary discipline as
 * `apps/web/features/wallet/voucher-detail-cache.ts`: `zod/mini` (not
 * `zod`) to stay out of the ~96 KB gz full-Zod client-bundle cost
 * (docs/13b-typescript-standards.md §3, §8), every read wrapped in
 * try/catch and schema-validated, and a failed write never breaks
 * rendering.
 *
 * `dayKey` uses the UTC date slice of an ISO timestamp rather than the
 * device's local calendar day — deterministic and testable without a
 * timezone-dependent test, at the cost of a redemption made right at local
 * midnight in a large-UTC-offset timezone occasionally landing in
 * "yesterday's" log for a few hours. Acceptable for a mock/offline-first
 * demo; a real device-provisioning ticket (YT-0446) should decide the
 * store's own timezone explicitly rather than trust the browser's.
 */
const STORAGE_PREFIX = "yourtal:merchant:today-log:";

const logEntryStatusValues = ["pending", "confirmed", "failed"] as const;

export const merchantLogEntrySchema = z.object({
  id: z.string().check(z.minLength(1)),
  voucherId: z.string().check(z.minLength(1)),
  voucherCode: z.string().check(z.minLength(1)),
  merchantName: z.string().check(z.minLength(1)),
  amountMinor: z.number().check(z.minimum(0)),
  status: z.enum(logEntryStatusValues),
  createdAt: z.iso.datetime(),
  confirmedAt: z.nullable(z.iso.datetime()),
  failureReason: z.nullable(z.string()),
});

export type MerchantLogEntry = z.infer<typeof merchantLogEntrySchema>;

const logSchema = z.array(merchantLogEntrySchema);

export function dayKeyFor(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function storageKey(deviceId: string, dayKey: string): string {
  return `${STORAGE_PREFIX}${deviceId}:${dayKey}`;
}

/** Reads today's log for a device, or `[]` if there is none or it fails to validate. Never throws. */
export function readTodayLog(deviceId: string, dayKey: string): MerchantLogEntry[] {
  try {
    if (typeof window === "undefined") {
      return [];
    }
    const raw = window.localStorage.getItem(storageKey(deviceId, dayKey));
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    const result = logSchema.safeParse(parsed);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

/** Best-effort write-through. A failed write must never break rendering — same contract as voucher-detail-cache.ts. */
export function writeTodayLog(
  deviceId: string,
  dayKey: string,
  entries: readonly MerchantLogEntry[],
): void {
  try {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(storageKey(deviceId, dayKey), JSON.stringify(entries));
  } catch {
    // Private mode, quota exceeded, or storage disabled.
  }
}

/**
 * How much of `remainingValueMinor` is still actually spendable, after
 * subtracting what this device has already confirmed OR queued (pending)
 * against this voucher today. This — not the voucher's own field — is
 * what `classifyRedemptionEligibility` must be checked against, or the
 * same voucher could be redeemed twice in the gap before an offline
 * capture syncs.
 */
export function effectiveRemainingValue(
  entries: readonly MerchantLogEntry[],
  voucherId: string,
  remainingValueMinor: number,
): number {
  const committed = entries
    .filter((entry) => entry.voucherId === voucherId && entry.status !== "failed")
    .reduce((sum, entry) => sum + entry.amountMinor, 0);
  return Math.max(0, remainingValueMinor - committed);
}

/** Sum of every confirmed capture today — the running total the fourth acceptance criterion asks for. Never counts pending or failed entries, so the total never overstates what has actually settled. */
export function confirmedRunningTotal(entries: readonly MerchantLogEntry[]): number {
  return entries
    .filter((entry) => entry.status === "confirmed")
    .reduce((sum, entry) => sum + entry.amountMinor, 0);
}

export function pendingEntries(entries: readonly MerchantLogEntry[]): MerchantLogEntry[] {
  return entries.filter((entry) => entry.status === "pending");
}
