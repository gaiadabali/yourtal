import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePriceLockCountdown } from "./use-price-lock-countdown";
import { computeLockExpiresAt } from "./price-lock";

/**
 * Advances fake timers one second at a time, each inside its own `act()`.
 * Same reasoning as `checkpoint/use-question-timer.test.tsx`: the hook
 * re-arms a fresh `setTimeout` from inside a `useEffect` on every tick, and
 * that effect only re-runs at an `act()` boundary — a single large
 * `advanceTimersByTime(N)` would only fire the first scheduled timeout.
 */
function advanceSeconds(seconds: number): void {
  for (let tick = 0; tick < seconds; tick += 1) {
    act(() => {
      vi.advanceTimersByTime(1000);
    });
  }
}

const NOW = new Date("2026-09-19T10:00:00.000Z");

describe("usePriceLockCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts from the full remaining time, not from a fresh duration counted from mount", () => {
    const lockExpiresAt = new Date(NOW.getTime() + 5_000).toISOString();
    const { result } = renderHook(() => usePriceLockCountdown(lockExpiresAt, vi.fn()));
    expect(result.current.secondsRemaining).toBe(5);
    expect(result.current.isExpired).toBe(false);
    expect(result.current.announcement).toContain("5 detik");
  });

  it("if the price was already shown a while ago, reflects the true remaining time immediately (never resets the clock)", () => {
    // The quote was shown 8 minutes ago; only 2 minutes of a 10-minute lock remain.
    const lockExpiresAt = computeLockExpiresAt(new Date(NOW.getTime() - 8 * 60_000));
    const { result } = renderHook(() => usePriceLockCountdown(lockExpiresAt, vi.fn()));
    expect(result.current.secondsRemaining).toBe(2 * 60);
  });

  it("counts down every second and calls onExpire exactly once when it reaches zero", () => {
    const lockExpiresAt = new Date(NOW.getTime() + 3_000).toISOString();
    const onExpire = vi.fn();
    const { result } = renderHook(() => usePriceLockCountdown(lockExpiresAt, onExpire));

    advanceSeconds(1);
    expect(result.current.secondsRemaining).toBe(2);
    expect(onExpire).not.toHaveBeenCalled();

    advanceSeconds(1);
    expect(result.current.secondsRemaining).toBe(1);
    expect(onExpire).not.toHaveBeenCalled();

    advanceSeconds(1);
    expect(result.current.secondsRemaining).toBe(0);
    expect(result.current.isExpired).toBe(true);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(result.current.announcement).toContain("tidak berlaku");

    // Further ticks must not fire onExpire a second time.
    advanceSeconds(2);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("announces at the final-minute thresholds without re-announcing every second", () => {
    const lockExpiresAt = new Date(NOW.getTime() + 65_000).toISOString();
    const { result } = renderHook(() => usePriceLockCountdown(lockExpiresAt, vi.fn()));
    const seenAnnouncements = [result.current.announcement];

    advanceSeconds(65);
    seenAnnouncements.push(result.current.announcement);

    // 65 ticks of visible countdown, far fewer distinct spoken announcements.
    expect(new Set(seenAnnouncements).size).toBeLessThan(65);
    expect(result.current.announcement).toContain("tidak berlaku");
  });

  it("a new quote (different lockExpiresAt) restarts the countdown and the expiry guard", () => {
    const firstLock = new Date(NOW.getTime() + 2_000).toISOString();
    const onExpire = vi.fn();
    const { result, rerender } = renderHook(({ lockExpiresAt }) => usePriceLockCountdown(lockExpiresAt, onExpire), {
      initialProps: { lockExpiresAt: firstLock },
    });

    advanceSeconds(2);
    expect(onExpire).toHaveBeenCalledTimes(1);

    const secondLock = new Date(Date.now() + 4_000).toISOString();
    rerender({ lockExpiresAt: secondLock });
    expect(result.current.secondsRemaining).toBe(4);
    expect(result.current.isExpired).toBe(false);

    advanceSeconds(4);
    expect(onExpire).toHaveBeenCalledTimes(2);
  });
});
