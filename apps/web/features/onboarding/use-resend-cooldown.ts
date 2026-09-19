"use client";

import { useEffect, useState } from "react";

export interface ResendCooldownState {
  readonly secondsRemaining: number;
  readonly canResend: boolean;
}

/**
 * Ticks down to `availableAt` (an epoch-ms timestamp) so "Resend code" can
 * show a live countdown instead of just being disabled with no explanation
 * (docs/tasks/phase-u-ui.md YT-0430's resend-state criterion). `null` means
 * no cooldown is active — resend is immediately available (the initial
 * "enter your phone" screen has not sent anything yet).
 *
 * Polls every 250 ms rather than once a second, purely for a smoother
 * final-second transition to `canResend: true`; the displayed value is
 * still whole seconds (`Math.ceil`), matching `resend.resendCooldownSuffix`
 * copy like "in 12s" / "dalam 12 detik".
 */
export function useResendCooldown(availableAt: number | null): ResendCooldownState {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (availableAt === null) {
      return;
    }
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 250);
    return () => window.clearInterval(intervalId);
  }, [availableAt]);

  if (availableAt === null) {
    return { secondsRemaining: 0, canResend: true };
  }

  const remainingMs = Math.max(0, availableAt - now);
  return { secondsRemaining: Math.ceil(remainingMs / 1000), canResend: remainingMs <= 0 };
}
