"use client";

import { useEffect, useRef, useState } from "react";
import { millisecondsUntilLock } from "./price-lock";

export interface PriceLockCountdownState {
  secondsRemaining: number;
  isExpired: boolean;
  /**
   * Text for a visually-hidden `aria-live="polite"` region. It only changes
   * at meaningful thresholds (start, the final minute's countdown, and
   * expiry) — not on every tick, which would be unusable spam for a
   * screen-reader user (same reasoning as `use-question-timer.ts`).
   */
  announcement: string;
}

const FINAL_COUNTDOWN_THRESHOLDS_SECONDS = new Set([60, 30, 10, 5, 4, 3, 2, 1]);

function computeSecondsRemaining(lockExpiresAt: string, nowMs: number): number {
  return Math.ceil(millisecondsUntilLock(lockExpiresAt, nowMs) / 1000);
}

function startAnnouncement(secondsRemaining: number): string {
  const minutes = Math.floor(secondsRemaining / 60);
  return minutes > 0
    ? `Harga ini terkunci selama sekitar ${minutes} menit.`
    : `Harga ini terkunci selama ${secondsRemaining} detik.`;
}

const EXPIRED_ANNOUNCEMENT =
  "Harga ini sudah tidak berlaku. Muat ulang untuk mendapatkan harga baru.";

/**
 * Ticks a countdown to `lockExpiresAt`, an absolute instant computed
 * server-side (see `price-lock.ts`'s module doc comment for why). Every
 * tick recomputes `secondsRemaining` from a fresh `Date.now()` rather than
 * decrementing a counter this hook owns, so a throttled or backgrounded tab
 * that misses ticks jumps straight to the true remaining time on its next
 * tick instead of drifting — the same wall-clock honesty that makes the
 * independent re-check in `burn-redemption.ts` meaningful rather than
 * redundant.
 *
 * Calls `onExpire` exactly once, the render after the lock actually
 * expires — never early, and never suppressed by a stale closure.
 */
export function usePriceLockCountdown(
  lockExpiresAt: string,
  onExpire: () => void,
): PriceLockCountdownState {
  const [secondsRemaining, setSecondsRemaining] = useState(() =>
    computeSecondsRemaining(lockExpiresAt, Date.now()),
  );
  const [announcement, setAnnouncement] = useState(() =>
    startAnnouncement(computeSecondsRemaining(lockExpiresAt, Date.now())),
  );
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  const hasFiredExpireRef = useRef(false);

  // A new quote (a different `lockExpiresAt`, e.g. after a re-quote) starts
  // the whole countdown over, including the "already fired" guard below.
  useEffect(() => {
    const initial = computeSecondsRemaining(lockExpiresAt, Date.now());
    setSecondsRemaining(initial);
    setAnnouncement(startAnnouncement(initial));
    hasFiredExpireRef.current = false;
  }, [lockExpiresAt]);

  useEffect(() => {
    if (secondsRemaining <= 0) {
      setAnnouncement(EXPIRED_ANNOUNCEMENT);
      if (!hasFiredExpireRef.current) {
        hasFiredExpireRef.current = true;
        onExpireRef.current();
      }
      return;
    }
    const timeoutId = window.setTimeout(() => {
      const next = computeSecondsRemaining(lockExpiresAt, Date.now());
      setSecondsRemaining(next);
      if (FINAL_COUNTDOWN_THRESHOLDS_SECONDS.has(next)) {
        setAnnouncement(`Kunci harga tersisa ${next} detik.`);
      }
    }, 1000);
    return () => window.clearTimeout(timeoutId);
  }, [secondsRemaining, lockExpiresAt]);

  return { secondsRemaining, isExpired: secondsRemaining <= 0, announcement };
}
