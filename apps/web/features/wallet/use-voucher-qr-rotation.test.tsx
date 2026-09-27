import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVoucherQrRotation } from "./use-voucher-qr-rotation";
import type { WalletQrDetail } from "./wallet-data";

const { refreshVoucherQrActionMock } = vi.hoisted(() => ({ refreshVoucherQrActionMock: vi.fn() }));
vi.mock("./refresh-voucher-qr-action", () => ({
  refreshVoucherQrAction: refreshVoucherQrActionMock,
}));

/** Same one-second-at-a-time re-arm pattern as the rest of this feature's timer hooks. */
function advanceSeconds(seconds: number): void {
  for (let tick = 0; tick < seconds; tick += 1) {
    act(() => {
      vi.advanceTimersByTime(1000);
    });
  }
}

const baseNowMs = Date.parse("2026-09-19T09:00:00.000Z");
const FIVE_MIN_MS = 5 * 60 * 1000;

function twelveWindows(startMs: number, prefix = "token"): WalletQrDetail["tokens"] {
  return Array.from({ length: 12 }, (_, i) => ({
    token: `${prefix}-${i}`,
    expiresAt: new Date(startMs + (i + 1) * FIVE_MIN_MS).toISOString(),
  }));
}

describe("useVoucherQrRotation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(baseNowMs);
    refreshVoucherQrActionMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts on the first of the twelve cached windows (6.5.b/4.5.b)", async () => {
    const initialQr: WalletQrDetail = {
      voucherId: "voucher-1",
      token: "token-0",
      expiresAt: new Date(baseNowMs + FIVE_MIN_MS).toISOString(),
      tokens: twelveWindows(baseNowMs),
    };
    const { result } = renderHook(() => useVoucherQrRotation("voucher-1", initialQr));
    await act(async () => {});

    expect(result.current.current?.token).toBe("token-0");
    expect(result.current.exhausted).toBe(false);
  });

  it("rotates into the next 5-minute window once the current one expires (6.5.c)", async () => {
    const initialQr: WalletQrDetail = {
      voucherId: "voucher-1",
      token: "token-0",
      expiresAt: new Date(baseNowMs + FIVE_MIN_MS).toISOString(),
      tokens: twelveWindows(baseNowMs),
    };
    const { result } = renderHook(() => useVoucherQrRotation("voucher-1", initialQr));
    await act(async () => {});

    advanceSeconds(FIVE_MIN_MS / 1000 + 1);

    expect(result.current.current?.token).toBe("token-1");
  });

  it("falls back to the one token given when the API has not widened to twelve yet", async () => {
    const initialQr: WalletQrDetail = {
      voucherId: "voucher-1",
      token: "only-token",
      expiresAt: new Date(baseNowMs + FIVE_MIN_MS).toISOString(),
    };
    const { result } = renderHook(() => useVoucherQrRotation("voucher-1", initialQr));
    await act(async () => {});

    expect(result.current.current?.token).toBe("only-token");
  });

  it("asks for a fresh batch once every cached window has expired, and rotates onto it", async () => {
    const initialQr: WalletQrDetail = {
      voucherId: "voucher-1",
      token: "token-0",
      expiresAt: new Date(baseNowMs + FIVE_MIN_MS).toISOString(),
      tokens: twelveWindows(baseNowMs),
    };
    const refreshedStart = baseNowMs + 12 * FIVE_MIN_MS;
    refreshVoucherQrActionMock.mockResolvedValue({
      ok: true,
      qr: {
        voucherId: "voucher-1",
        token: "fresh-0",
        expiresAt: new Date(refreshedStart + FIVE_MIN_MS).toISOString(),
        tokens: twelveWindows(refreshedStart, "fresh"),
      },
    });

    const { result } = renderHook(() => useVoucherQrRotation("voucher-1", initialQr));
    await act(async () => {});

    advanceSeconds(12 * (FIVE_MIN_MS / 1000) + 1);
    // Flush the refresh action's own promise chain (its `.then` plus the
    // state update it schedules) across a few microtask hops.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(refreshVoucherQrActionMock).toHaveBeenCalledWith("voucher-1");
    expect(result.current.current?.token).toBe("fresh-0");
  });

  it("stays exhausted and reports the refresh as failed when offline (6.5.c)", async () => {
    const initialQr: WalletQrDetail = {
      voucherId: "voucher-1",
      token: "token-0",
      expiresAt: new Date(baseNowMs + FIVE_MIN_MS).toISOString(),
      tokens: twelveWindows(baseNowMs),
    };
    refreshVoucherQrActionMock.mockResolvedValue({ ok: false });

    const { result } = renderHook(() => useVoucherQrRotation("voucher-1", initialQr));
    await act(async () => {});

    advanceSeconds(12 * (FIVE_MIN_MS / 1000) + 1);
    await act(async () => {});

    expect(result.current.exhausted).toBe(true);
    expect(result.current.refreshFailed).toBe(true);
  });
});
