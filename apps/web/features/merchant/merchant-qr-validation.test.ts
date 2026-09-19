import { describe, expect, it } from "vitest";
import { computeQrPayload, currentRotationWindow } from "@/features/wallet/voucher-qr-rotation";
import { validateScannedPayload } from "./merchant-qr-validation";

const voucher = { id: "voucher-1", code: "ABC123XYZ", expiresAt: "2026-09-19T10:00:00.000Z" };
const nowMs = Date.parse("2026-09-19T09:00:10.000Z");

describe("validateScannedPayload", () => {
  it("accepts a payload computed by the wallet's exact scheme for the current window — proving the two halves agree", () => {
    const windowIndex = currentRotationWindow(nowMs);
    const payload = computeQrPayload(voucher, windowIndex);
    const result = validateScannedPayload(payload, [voucher], nowMs);
    expect(result).toEqual({ ok: true, voucherId: voucher.id });
  });

  it("accepts a payload from one window ago or ahead — clock/latency tolerance", () => {
    const windowIndex = currentRotationWindow(nowMs);
    const previous = computeQrPayload(voucher, windowIndex - 1);
    const next = computeQrPayload(voucher, windowIndex + 1);
    expect(validateScannedPayload(previous, [voucher], nowMs)).toEqual({
      ok: true,
      voucherId: voucher.id,
    });
    expect(validateScannedPayload(next, [voucher], nowMs)).toEqual({
      ok: true,
      voucherId: voucher.id,
    });
  });

  it("rejects a payload more than one window stale", () => {
    const windowIndex = currentRotationWindow(nowMs);
    const stale = computeQrPayload(voucher, windowIndex - 2);
    expect(validateScannedPayload(stale, [voucher], nowMs)).toEqual({
      ok: false,
      error: { type: "signature_mismatch" },
    });
  });

  it("rejects a well-formed payload for a voucher this device does not know about", () => {
    const windowIndex = currentRotationWindow(nowMs);
    const payload = computeQrPayload({ ...voucher, id: "someone-elses-voucher" }, windowIndex);
    expect(validateScannedPayload(payload, [voucher], nowMs)).toEqual({
      ok: false,
      error: { type: "unknown_voucher" },
    });
  });

  it("rejects a tampered hash — same voucher and window, wrong signature", () => {
    const windowIndex = currentRotationWindow(nowMs);
    const payload = computeQrPayload(voucher, windowIndex);
    const tampered = payload.slice(0, -1) + (payload.endsWith("0") ? "1" : "0");
    expect(validateScannedPayload(tampered, [voucher], nowMs)).toEqual({
      ok: false,
      error: { type: "signature_mismatch" },
    });
  });

  it("rejects malformed input without throwing", () => {
    expect(validateScannedPayload("not-a-qr-payload", [voucher], nowMs)).toEqual({
      ok: false,
      error: { type: "malformed" },
    });
    expect(validateScannedPayload("", [voucher], nowMs)).toEqual({
      ok: false,
      error: { type: "malformed" },
    });
    expect(validateScannedPayload("YT1.voucher-1.notanumber.ABC", [voucher], nowMs)).toEqual({
      ok: false,
      error: { type: "malformed" },
    });
  });
});
