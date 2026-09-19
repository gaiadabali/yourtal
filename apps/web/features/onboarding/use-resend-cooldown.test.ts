import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useResendCooldown } from "./use-resend-cooldown";

const NOW = new Date("2026-09-19T10:00:00.000Z").getTime();

describe("useResendCooldown", () => {
  it("allows resending immediately when there is no active cooldown", () => {
    const { result } = renderHook(() => useResendCooldown(null));
    expect(result.current).toStrictEqual({ secondsRemaining: 0, canResend: true });
  });

  describe("with an active cooldown", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("reports seconds remaining and blocks resend until the cooldown elapses", () => {
      const { result } = renderHook(() => useResendCooldown(NOW + 10_000));
      expect(result.current.canResend).toBe(false);
      expect(result.current.secondsRemaining).toBe(10);

      act(() => {
        vi.setSystemTime(NOW + 6_000);
        vi.advanceTimersByTime(250);
      });
      expect(result.current.canResend).toBe(false);
      expect(result.current.secondsRemaining).toBe(4);

      act(() => {
        vi.setSystemTime(NOW + 10_000);
        vi.advanceTimersByTime(250);
      });
      expect(result.current.canResend).toBe(true);
      expect(result.current.secondsRemaining).toBe(0);
    });
  });
});
