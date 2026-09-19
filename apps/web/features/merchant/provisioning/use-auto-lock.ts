"use client";

import { useEffect, useRef } from "react";

/**
 * The threat model this hook is actually for (docs/17-surfaces-and-roles.md
 * section 2.2, and this ticket's brief): "the device being left unlocked
 * on a counter... a phone that walks out of the shop." Neither of those is
 * defeated by PIN complexity — they are defeated by locking fast and
 * locking on the right signal. This is why auto-lock, not the PIN itself,
 * is the actual security control here; the PIN is only a convenience gate
 * on top of it.
 *
 * Two independent triggers, both calling `onIdle`:
 *  - Inactivity: no pointer/keyboard/touch activity for `idleMs`. Resets
 *    on every such event, cleared and restarted, never accumulated.
 *  - Visibility: the tab going `hidden` (screen locked, app switched away
 *    from, or the browser minimised) locks IMMEDIATELY, not after the idle
 *    timer — this is the "phone walks out of the shop" case, and waiting
 *    out an idle timer after the screen is already off would defeat the
 *    point.
 *
 * Deliberately excludes scroll and mousemove from the activity list: a
 * customer glancing at a receipt being read off the counter screen while
 * an idle staff member has genuinely stepped away should not indefinitely
 * hold the session open.
 */
export const AUTO_LOCK_IDLE_MS = 90_000;

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart"] as const;

export function useAutoLock(onIdle: () => void, idleMs: number = AUTO_LOCK_IDLE_MS): void {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    function scheduleLock() {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => onIdleRef.current(), idleMs);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        onIdleRef.current();
      }
    }

    scheduleLock();
    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, scheduleLock);
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handleVisibilityChange);

    return () => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      for (const eventName of ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, scheduleLock);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handleVisibilityChange);
    };
  }, [idleMs]);
}
