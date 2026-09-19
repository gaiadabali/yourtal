import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVoucherQrRotation } from "./use-voucher-qr-rotation";
import { QR_ROTATION_INTERVAL_MS } from "./voucher-qr-rotation";

/**
 * Same one-second-at-a-time pattern as
 * apps/web/features/checkpoint/use-question-timer.test.tsx: the hook
 * re-arms a fresh `setTimeout` from inside a `useEffect` on every tick, so
 * a single large `vi.advanceTimersByTime(N)` would only flush the first
 * pending timeout — later ones need React to flush effects at an `act()`
 * boundary first.
 */
function advanceSeconds(seconds: number): void {
  for (let tick = 0; tick < seconds; tick += 1) {
    act(() => {
      vi.advanceTimersByTime(1000);
    });
  }
}

const baseNowMs = Date.parse("2026-09-19T09:00:00.000Z");

describe("useVoucherQrRotation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(baseNowMs);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const voucher = { id: "voucher-1", code: "CODE123", expiresAt: "2026-09-19T09:05:00.000Z" };

  it("starts with a full rotation window and not expired", () => {
    const { result } = renderHook(() => useVoucherQrRotation(voucher));
    expect(result.current.isExpired).toBe(false);
    expect(result.current.secondsUntilRotation).toBeGreaterThan(0);
    expect(result.current.secondsUntilRotation).toBeLessThanOrEqual(QR_ROTATION_INTERVAL_MS / 1000);
  });

  it("rotates the payload once the interval elapses, deterministically from voucher data + time", () => {
    const { result } = renderHook(() => useVoucherQrRotation(voucher));
    const firstPayload = result.current.payload;

    advanceSeconds(QR_ROTATION_INTERVAL_MS / 1000);

    expect(result.current.payload).not.toBe(firstPayload);
  });

  it("counts the validity countdown down every second", () => {
    const { result } = renderHook(() => useVoucherQrRotation(voucher));
    const initialSeconds = result.current.secondsUntilRotation;

    advanceSeconds(1);

    expect(result.current.secondsUntilRotation).toBe(initialSeconds - 1);
  });

  it("marks the voucher expired once its expiresAt is reached, and stops advancing further", () => {
    const { result } = renderHook(() => useVoucherQrRotation(voucher));

    advanceSeconds(5 * 60); // 5 minutes — past the voucher's 09:05:00 expiry

    expect(result.current.isExpired).toBe(true);
    expect(result.current.secondsUntilExpiry).toBe(0);

    const expiredPayload = result.current.payload;
    advanceSeconds(60);
    // No more ticking once expired — the hook stops re-arming its timer.
    expect(result.current.payload).toBe(expiredPayload);
  });
});
