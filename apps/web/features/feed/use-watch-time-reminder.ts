"use client";

import { useEffect, useRef, useState } from "react";

/** F12 / 12.2.b: "a sensible continuous-watching threshold (say 45 min)". */
const THRESHOLD_MS = 45 * 60 * 1000;
const TICK_MS = 30_000;

/**
 * A gentle, non-blocking watch-time reminder for a teen scrolling the feed
 * (12.2.b). Counts only FOREGROUND time (paused while the tab is hidden,
 * same `document.hidden` discipline `home-feed.tsx`'s own autoplay pause
 * and `use-quick-earn.ts`'s report loop already follow, EW-14) since the
 * feed mounted — simple client-side accounting, no server round trip, and
 * nothing here blocks or pauses playback. Dismissing clears the banner for
 * the rest of this feed session; it does not reset or repeat the timer —
 * one gentle nudge, not a nag.
 */
export function useWatchTimeReminder(enabled: boolean): { show: boolean; dismiss: () => void } {
  const [show, setShow] = useState(false);
  const dismissedRef = useRef(false);
  const elapsedMsRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      elapsedMsRef.current += TICK_MS;
      if (!dismissedRef.current && elapsedMsRef.current >= THRESHOLD_MS) setShow(true);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [enabled]);

  const dismiss = () => {
    dismissedRef.current = true;
    setShow(false);
  };

  return { show, dismiss };
}
