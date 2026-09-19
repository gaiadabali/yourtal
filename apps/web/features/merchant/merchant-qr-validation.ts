import type { VoucherQrSource } from "@/features/wallet/voucher-qr-rotation";
import { computeQrPayload, currentRotationWindow } from "@/features/wallet/voucher-qr-rotation";

/**
 * Validates a scanned QR payload against the EXACT scheme
 * `apps/web/features/wallet/voucher-qr-rotation.ts` computes for the
 * consumer wallet's rotating voucher QR (YT-0424): an FNV-1a hash over
 * `[voucher.id, voucher.code, windowIndex]`, `windowIndex = floor(nowMs /
 * 30_000)`.
 *
 * This imports `computeQrPayload`/`currentRotationWindow` directly from
 * that feature rather than re-implementing the hash — the ticket brief is
 * explicit that a second, hand-copied scheme is exactly how "a real
 * voucher reads as invalid" happens the moment the two features drift.
 * Both functions are pure, dependency-free and already isolated from
 * anything React/DOM-specific, so importing them here carries no more
 * weight than importing a shared utility would (this codebase already
 * has one precedent for a cross-feature import of a small pure module:
 * `apps/web/features/quick/quick-feed-card.tsx` importing
 * `campaign-format.ts`). `voucher-qr-rotation.ts` itself is read-only
 * from here — nothing in this file, or anywhere else in
 * `features/merchant`, edits it.
 *
 * A one-window tolerance either side of "now" absorbs the real-world gap
 * between the instant the customer's phone drew the code and the instant
 * this device's camera decodes it — network/render latency, clock drift
 * between two devices, and the decode loop's own polling interval can
 * each burn a few seconds, which is enough to cross a 30 s rotation
 * boundary even for a genuine, freshly-shown code.
 */
const WINDOW_TOLERANCE = 1;

export type QrValidationError =
  { type: "malformed" } | { type: "unknown_voucher" } | { type: "signature_mismatch" };

export type QrValidationResult =
  { ok: true; voucherId: string } | { ok: false; error: QrValidationError };

interface ParsedPayload {
  voucherId: string;
  windowIndex: number;
}

const PAYLOAD_PREFIX = "YT1";

/** Splits `YT1.{voucherId}.{windowIndex}.{hash}` without trusting any part of it. */
function parsePayload(raw: string): ParsedPayload | null {
  const parts = raw.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const [prefix, voucherId, windowIndexRaw] = parts;
  if (prefix !== PAYLOAD_PREFIX || !voucherId) {
    return null;
  }
  if (!windowIndexRaw || !/^-?\d+$/.test(windowIndexRaw)) {
    return null;
  }
  return { voucherId, windowIndex: Number.parseInt(windowIndexRaw, 10) };
}

/**
 * Validates a raw scanned string against the set of vouchers this device
 * has cached (docs/09 §8.3's "signature verified locally against a cached
 * public key" — here the wallet's rotating hash stands in for the real
 * Ed25519 signature that scheme describes, see
 * `voucher-qr-rotation.ts`'s own doc comment on that gap). Returns which
 * voucher matched; it does NOT decide whether that voucher is eligible for
 * redemption — that is `classifyRedemptionEligibility`'s job, once the
 * full `Voucher` record is loaded, so a stale-but-well-formed code and an
 * expired-but-well-formed code get their own distinct, honest messages
 * instead of being collapsed into one "invalid" bucket.
 */
export function validateScannedPayload(
  raw: string,
  candidates: readonly VoucherQrSource[],
  nowMs: number,
): QrValidationResult {
  const parsed = parsePayload(raw.trim());
  if (!parsed) {
    return { ok: false, error: { type: "malformed" } };
  }

  const voucher = candidates.find((candidate) => candidate.id === parsed.voucherId);
  if (!voucher) {
    return { ok: false, error: { type: "unknown_voucher" } };
  }

  const currentWindow = currentRotationWindow(nowMs);
  for (let offset = -WINDOW_TOLERANCE; offset <= WINDOW_TOLERANCE; offset += 1) {
    const candidateWindow = currentWindow + offset;
    if (
      parsed.windowIndex === candidateWindow &&
      computeQrPayload(voucher, candidateWindow) === raw.trim()
    ) {
      return { ok: true, voucherId: voucher.id };
    }
  }
  return { ok: false, error: { type: "signature_mismatch" } };
}
