import { describe, expect, it } from "vitest";
import {
  QR_ROTATION_INTERVAL_MS,
  computeQrPayload,
  currentRotationWindow,
  msUntilExpiry,
  msUntilNextRotation,
} from "./voucher-qr-rotation";

const voucher = { id: "voucher-1", code: "ABC123XYZ", expiresAt: "2026-09-19T10:00:00.000Z" };

describe("voucher-qr-rotation", () => {
  it("computes the same rotation window for the same instant, deterministically", () => {
    const nowMs = Date.parse("2026-09-19T09:00:10.000Z");
    expect(currentRotationWindow(nowMs)).toBe(currentRotationWindow(nowMs));
    expect(currentRotationWindow(nowMs)).toBe(Math.floor(nowMs / QR_ROTATION_INTERVAL_MS));
  });

  it("advances the rotation window once a full interval has elapsed", () => {
    const nowMs = Date.parse("2026-09-19T09:00:00.000Z");
    const windowNow = currentRotationWindow(nowMs);
    const windowLater = currentRotationWindow(nowMs + QR_ROTATION_INTERVAL_MS);
    expect(windowLater).toBe(windowNow + 1);
  });

  it("produces a byte-identical payload for the same voucher and window, every time — never Math.random()", () => {
    const payloadA = computeQrPayload(voucher, 42);
    const payloadB = computeQrPayload(voucher, 42);
    expect(payloadA).toBe(payloadB);
  });

  it("produces a different payload for a different rotation window", () => {
    const payloadWindow1 = computeQrPayload(voucher, 1);
    const payloadWindow2 = computeQrPayload(voucher, 2);
    expect(payloadWindow1).not.toBe(payloadWindow2);
  });

  it("produces a different payload for a different voucher in the same window", () => {
    const otherVoucher = { ...voucher, id: "voucher-2" };
    expect(computeQrPayload(voucher, 5)).not.toBe(computeQrPayload(otherVoucher, 5));
  });

  it("counts down the milliseconds remaining until the next rotation, never negative", () => {
    const windowStartMs = currentRotationWindow(Date.now()) * QR_ROTATION_INTERVAL_MS;
    const remaining = msUntilNextRotation(windowStartMs + 5_000);
    expect(remaining).toBe(QR_ROTATION_INTERVAL_MS - 5_000);
    expect(remaining).toBeGreaterThan(0);
  });

  it("clamps milliseconds-until-expiry at zero once the voucher has expired", () => {
    const expiredNowMs = Date.parse(voucher.expiresAt) + 1_000;
    expect(msUntilExpiry(voucher, expiredNowMs)).toBe(0);
  });

  it("reports positive milliseconds remaining before expiry", () => {
    const beforeExpiryMs = Date.parse(voucher.expiresAt) - 10_000;
    expect(msUntilExpiry(voucher, beforeExpiryMs)).toBe(10_000);
  });
});
