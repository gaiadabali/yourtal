import { describe, expect, it } from "vitest";
import { selectQrWindow, type QrWindow } from "./voucher-qr-rotation";

// Twelve consecutive 5-minute windows starting at the reference instant,
// the same batch shape `services/voucher`'s `qrtoken.Mint` returns (4.5.b).
const START_MS = Date.parse("2026-09-19T09:00:00.000Z");
const FIVE_MIN_MS = 5 * 60 * 1000;

function windowsFrom(startMs: number, count: number): QrWindow[] {
  return Array.from({ length: count }, (_, i) => ({
    token: `token-${i}`,
    expiresAt: new Date(startMs + (i + 1) * FIVE_MIN_MS).toISOString(),
  }));
}

describe("selectQrWindow", () => {
  it("picks the first window (6.5.c: it rotates every window)", () => {
    const windows = windowsFrom(START_MS, 12);
    const state = selectQrWindow(windows, START_MS);
    expect(state.current?.token).toBe("token-0");
    expect(state.exhausted).toBe(false);
    expect(state.secondsUntilRotation).toBe(300);
  });

  it("rotates into the next window once the current one's expiry passes", () => {
    const windows = windowsFrom(START_MS, 12);
    const state = selectQrWindow(windows, START_MS + FIVE_MIN_MS + 1);
    expect(state.current?.token).toBe("token-1");
  });

  it("is exhausted once every cached window (an hour's worth) has expired", () => {
    const windows = windowsFrom(START_MS, 12);
    const state = selectQrWindow(windows, START_MS + 12 * FIVE_MIN_MS + 1);
    expect(state.current).toBeNull();
    expect(state.exhausted).toBe(true);
    expect(state.secondsUntilRotation).toBe(0);
  });

  it("is exhausted immediately when handed no windows at all", () => {
    expect(selectQrWindow([], Date.now()).exhausted).toBe(true);
  });
});
