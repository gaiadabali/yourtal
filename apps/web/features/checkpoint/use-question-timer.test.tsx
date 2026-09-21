import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import idID from "@/messages/id-ID/checkpoint.json";
import { useQuestionTimer } from "./use-question-timer";

/**
 * Real `id-ID` catalogue via `useTranslations("checkpoint")` — the same
 * primitive `checkpoint-timer.tsx` uses in production (YT-0405), rather than
 * `createTranslator` (`checkpoint-i18n.ts`'s synchronous translator): the
 * two next-intl factories return structurally distinct overloaded function
 * types, and `useQuestionTimer`'s `t` parameter is typed against
 * `useTranslations`'s result, so this test obtains one the identical way.
 */
function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="id-ID" messages={{ checkpoint: idID }}>
      {children}
    </NextIntlClientProvider>
  );
}

/**
 * Advances fake timers one second at a time, each inside its own `act()`.
 * The hook's effect chain re-arms a fresh `setTimeout` every tick from
 * inside a `useEffect`; a single large `vi.advanceTimersByTime(N)` only
 * flushes the *first* pending timeout synchronously; the effect that
 * schedules the next one does not re-run until React flushes effects at an
 * `act()` boundary, so later timeouts within the same jump never fire. One
 * `act()` per second keeps the effect chain in step with the fake clock.
 */
function advanceSeconds(seconds: number): void {
  for (let tick = 0; tick < seconds; tick += 1) {
    act(() => {
      vi.advanceTimersByTime(1000);
    });
  }
}

describe("useQuestionTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("announces the total time up front, not just showing it", () => {
    const { result } = renderHook(
      () => {
        const t = useTranslations("checkpoint");
        return useQuestionTimer(12, vi.fn(), t);
      },
      { wrapper },
    );
    expect(result.current.remainingSeconds).toBe(12);
    expect(result.current.announcement).toContain("12 detik");
  });

  it("counts down every second visually, but does not re-announce every second", () => {
    const { result } = renderHook(
      () => {
        const t = useTranslations("checkpoint");
        return useQuestionTimer(12, vi.fn(), t);
      },
      { wrapper },
    );
    const seenAnnouncements = [result.current.announcement];

    for (let tick = 0; tick < 11; tick += 1) {
      advanceSeconds(1);
      seenAnnouncements.push(result.current.announcement);
    }

    expect(result.current.remainingSeconds).toBe(1);
    // 12 ticks of visible countdown, but far fewer distinct spoken
    // announcements — the "not every second" acceptance criterion.
    const distinctAnnouncements = new Set(seenAnnouncements);
    expect(distinctAnnouncements.size).toBeLessThan(seenAnnouncements.length);
    expect(result.current.announcement).toContain("1 detik");
  });

  it("announces at a final countdown threshold (5 seconds remaining)", () => {
    const { result } = renderHook(
      () => {
        const t = useTranslations("checkpoint");
        return useQuestionTimer(20, vi.fn(), t);
      },
      { wrapper },
    );
    advanceSeconds(15);
    expect(result.current.remainingSeconds).toBe(5);
    expect(result.current.announcement).toContain("5 detik");
  });

  it("calls onExpire exactly once when the timer reaches zero", () => {
    const onExpire = vi.fn();
    renderHook(
      () => {
        const t = useTranslations("checkpoint");
        return useQuestionTimer(3, onExpire, t);
      },
      { wrapper },
    );

    advanceSeconds(3);
    expect(onExpire).toHaveBeenCalledTimes(1);

    advanceSeconds(3);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
