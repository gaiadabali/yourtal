"use client";

import { useEffect, useRef, useState } from "react";
import type { VoucherQrSource } from "./voucher-qr-rotation";
import {
  computeQrPayload,
  currentRotationWindow,
  msUntilExpiry,
  msUntilNextRotation,
} from "./voucher-qr-rotation";

export interface VoucherQrRotationState {
  payload: string;
  secondsUntilRotation: number;
  secondsUntilExpiry: number;
  isExpired: boolean;
}

function computeState(voucher: VoucherQrSource, nowMs: number): VoucherQrRotationState {
  const windowIndex = currentRotationWindow(nowMs);
  const remainingExpiryMs = msUntilExpiry(voucher, nowMs);
  return {
    payload: computeQrPayload(voucher, windowIndex),
    secondsUntilRotation: Math.ceil(msUntilNextRotation(nowMs) / 1000),
    secondsUntilExpiry: Math.ceil(remainingExpiryMs / 1000),
    isExpired: remainingExpiryMs <= 0,
  };
}

/**
 * Ticks the rotating QR payload and its validity countdown once a second.
 * `nowProvider` defaults to `Date.now` and is injectable so tests can drive
 * it deterministically with fake timers instead of the wall clock.
 *
 * Re-arms a fresh `setTimeout` from inside the effect on every tick, the
 * same pattern as apps/web/features/checkpoint/use-question-timer.ts —
 * see that file's test for why a test must advance fake timers one second
 * at a time, each inside its own `act()`.
 */
export function useVoucherQrRotation(
  voucher: VoucherQrSource,
  nowProvider: () => number = Date.now,
): VoucherQrRotationState {
  const [state, setState] = useState(() => computeState(voucher, nowProvider()));
  const voucherRef = useRef(voucher);
  voucherRef.current = voucher;
  const nowProviderRef = useRef(nowProvider);
  nowProviderRef.current = nowProvider;

  // Only re-syncs when the voucher identity itself changes — voucherRef/
  // nowProviderRef are refs (always current), and a fresh nowProvider
  // reference on every render must not restart the tick chain. This
  // repo's react-hooks/exhaustive-deps only runs on .tsx/.jsx files, so
  // there is nothing for a disable comment to suppress here.
  useEffect(() => {
    setState(computeState(voucherRef.current, nowProviderRef.current()));
  }, [voucher.id, voucher.code, voucher.expiresAt]);

  useEffect(() => {
    if (state.isExpired) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setState(computeState(voucherRef.current, nowProviderRef.current()));
    }, 1000);
    return () => window.clearTimeout(timeoutId);
  }, [state]);

  return state;
}
