"use client";

import { useEffect, useState } from "react";

/**
 * Tracks connectivity via the `online`/`offline` window events, seeded
 * from `navigator.onLine`. This is the signal `merchant-redemption-screen.tsx`
 * uses to decide, at the moment of confirming a redemption, whether to
 * attempt the (simulated) authorize+capture call at all or queue it
 * straight to the offline log — the ticket brief's "design for [poor
 * connectivity], not a desk".
 *
 * `navigator.onLine` is a best-effort signal (a device can report "online"
 * while actually unable to reach anything — a captive portal, a dead
 * upstream link past the router), not a network guarantee. That is
 * acceptable here because it is never the ONLY thing standing between
 * staff and a false "success": `attemptRedemption` still re-classifies
 * eligibility and can still return a `network_error` for the UI to show
 * honestly, and `network_error` is retryable rather than fatal.
 *
 * Seeded `true` unconditionally, matching a server render (no `navigator`
 * there) — reading `navigator.onLine` in the initial state itself, rather
 * than an effect, is a real hydration mismatch the moment the browser's
 * OWN first-paint value differs from the server's assumed default (found
 * live-testing 8.2.a: every headless-Chromium reload of `/merchant`
 * reproduced this deterministically). The `useEffect` below corrects the
 * real value immediately after mount, same as any other browser-only
 * read — a person never sees the wrong banner for longer than one paint,
 * and the server/client markup for that very first paint now always
 * agrees.
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    function handleOnline() {
      setIsOnline(true);
    }
    function handleOffline() {
      setIsOnline(false);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}
