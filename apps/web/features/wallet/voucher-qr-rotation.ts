/**
 * Deterministic rotating QR payload for a voucher (YT-0424). Driven purely
 * by voucher data and time — never `Math.random()` — so the exact same
 * `(voucher, timestamp)` pair always produces the exact same payload,
 * whether that's on the client, in a test with fake timers, or (someday)
 * on a merchant's verifying device. That determinism is what makes
 * rotation and expiry testable at all.
 *
 * This is a UI-level rotating token, not the Ed25519-signed QR
 * docs/09-points-economy-and-redemption.md §8.3 describes for production
 * in-store redemption — a real signature needs a private key that must
 * never ship to the browser. Wiring this up to real server-side signing is
 * backend/merchant-integration work outside this ticket's scope; see the
 * final report for that follow-up.
 *
 * The hash below reuses the FNV-1a fold from
 * apps/web/features/checkpoint/checkpoint-seeded-shuffle.ts (same
 * dependency-free, deterministic pattern; not shared as an import because
 * that file is scoped to the checkpoint feature and this repo bans
 * cross-feature deep imports for anything that isn't a real shared
 * package).
 */
export const QR_ROTATION_INTERVAL_MS = 30_000;

export interface VoucherQrSource {
  id: string;
  code: string;
  expiresAt: string;
}

function hashToken(parts: ReadonlyArray<string | number>): string {
  const input = parts.join("|");
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(7, "0");
}

/** Which rotation window `nowMs` falls into — a pure function of time and the interval, the same for every voucher at the same instant. */
export function currentRotationWindow(nowMs: number, intervalMs: number = QR_ROTATION_INTERVAL_MS): number {
  return Math.floor(nowMs / intervalMs);
}

/** Milliseconds remaining until the current rotation window ends. */
export function msUntilNextRotation(nowMs: number, intervalMs: number = QR_ROTATION_INTERVAL_MS): number {
  const windowStartMs = currentRotationWindow(nowMs, intervalMs) * intervalMs;
  return windowStartMs + intervalMs - nowMs;
}

/** Deterministic payload for one voucher in one rotation window. Same inputs -> byte-identical output, always. */
export function computeQrPayload(voucher: VoucherQrSource, windowIndex: number): string {
  return `YT1.${voucher.id}.${windowIndex}.${hashToken([voucher.id, voucher.code, windowIndex])}`;
}

/** Milliseconds remaining until the voucher itself expires, clamped at 0. */
export function msUntilExpiry(voucher: VoucherQrSource, nowMs: number): number {
  return Math.max(0, new Date(voucher.expiresAt).getTime() - nowMs);
}
