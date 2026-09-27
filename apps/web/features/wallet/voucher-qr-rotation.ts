/**
 * QR rotation logic for a voucher (6.5.b/6.5.c). Two schemes live here:
 *
 * - `selectQrWindow` (current, 4.5.b): picks among already-signed tokens
 *   `services/voucher`'s keyring minted server-side — this feature's own
 *   UI (`voucher-detail-view.tsx`, `use-voucher-qr-rotation.ts`) uses only
 *   this one now. No signing, no `Math.random()`, no client-side token
 *   generation happens in this file.
 * - `computeQrPayload`/`currentRotationWindow`/`VoucherQrSource` (Phase U,
 *   kept for back-compat): a deterministic client-computed hash, the
 *   prototype's stand-in for a real signature before the real QR endpoint
 *   (4.5.b) existed. Nothing in this feature calls these any more, but
 *   `apps/web/features/merchant/merchant-qr-validation.ts` (Area C) still
 *   imports them to validate against — that file's own doc comment already
 *   flags the real fix ("wiring this up to real server-side signing is
 *   backend/merchant-integration work outside this ticket's scope") as a
 *   later, Area C ticket. Removing these here would break that file's
 *   build today for a migration this ticket does not own, so they stay
 *   until Area C moves off them.
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
export function currentRotationWindow(
  nowMs: number,
  intervalMs: number = QR_ROTATION_INTERVAL_MS,
): number {
  return Math.floor(nowMs / intervalMs);
}

/** Milliseconds remaining until the current rotation window ends. */
export function msUntilNextRotation(
  nowMs: number,
  intervalMs: number = QR_ROTATION_INTERVAL_MS,
): number {
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

// ---------------------------------------------------------------------------
// Current scheme (4.5.b): pure window-selection over already-signed tokens.
// ---------------------------------------------------------------------------

export interface QrWindow {
  token: string;
  /** ISO instant this window's token stops being valid. */
  expiresAt: string;
}

export interface QrRotationState {
  /** The token for the current window, or `null` once every cached window has expired. */
  current: QrWindow | null;
  secondsUntilRotation: number;
  /** True once `nowMs` is past every window's `expiresAt` — nothing left to rotate into. */
  exhausted: boolean;
}

/**
 * The first window (windows are consecutive and sorted oldest first) whose
 * `expiresAt` is still in the future is the current one — everything
 * before it has already rotated past.
 */
export function selectQrWindow(windows: readonly QrWindow[], nowMs: number): QrRotationState {
  const current = windows.find((window) => new Date(window.expiresAt).getTime() > nowMs) ?? null;
  return {
    current,
    secondsUntilRotation: current
      ? Math.max(0, Math.ceil((new Date(current.expiresAt).getTime() - nowMs) / 1000))
      : 0,
    exhausted: current === null,
  };
}
