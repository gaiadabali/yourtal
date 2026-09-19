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
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
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
