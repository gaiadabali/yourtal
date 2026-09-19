"use client";

import { useEffect, useState } from "react";

/**
 * Tracks whether this tab is the visible, focused one, via the Page
 * Visibility API and window focus/blur.
 *
 * READ BEFORE REUSING THIS ANYWHERE NEAR FRAUD/VERIFICATION LOGIC:
 * docs/23-critique.md §1.0 and docs/08-web-app-and-performance.md §2.1
 * document, as a confirmed (not suspected) finding, that Page Visibility is
 * "spec-mandated to release when hidden; no browser fires it on the
 * app-switcher; defeated by two lines of JavaScript"
 * (`Object.defineProperty(document, "hidden", { get: () => false })` plus
 * the same for `visibilityState` is enough). It is NOT a fraud control and
 * must never be presented as one, or as evidence a real reward-issuance
 * decision could be based on.
 *
 * What this hook IS for: driving a real, honest, *visible* UI state change
 * — "your reward accrual indicator paused because this tab is in the
 * background" — for the honest majority of users, purely as feedback. The
 * platform's actual reward-issuance gate is server-side (docs/08 §2.1a);
 * this hook has no connection to it and controls no reward math, only what
 * the accrual indicator displays.
 */
export function useTabVisibility(): boolean {
  const [isVisible, setIsVisible] = useState<boolean>(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );

  useEffect(() => {
    function handleVisibilityChange() {
      setIsVisible(document.visibilityState === "visible");
    }
    function handleFocus() {
      setIsVisible(document.visibilityState === "visible");
    }
    function handleBlur() {
      setIsVisible(false);
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  return isVisible;
}
