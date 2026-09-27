"use client";

import { useEffect, useRef, useState } from "react";
import type { WalletQrDetail } from "./wallet-data";
import { refreshVoucherQrAction } from "./refresh-voucher-qr-action";
import { readCachedQrWindows, writeCachedQrWindows } from "./voucher-qr-idb-cache";
import { selectQrWindow, type QrRotationState, type QrWindow } from "./voucher-qr-rotation";

export interface VoucherQrRotationState extends QrRotationState {
  /** True once we have tried a live refresh and it also failed/was offline — nothing left to show but the static fallback. */
  refreshFailed: boolean;
}

function windowsOf(qr: Pick<WalletQrDetail, "token" | "expiresAt" | "tokens">): QrWindow[] {
  // `tokens` is 4.5.b's full twelve-window batch (once Area A's wallet route
  // widens to carry it, see wallet-data.ts) — fall back to the one window
  // `token`/`expiresAt` always carries today.
  return qr.tokens && qr.tokens.length > 0
    ? qr.tokens
    : [{ token: qr.token, expiresAt: qr.expiresAt }];
}

/**
 * Ticks the rotating QR payload once a second, cache-first from IndexedDB
 * (6.5.c: "shows with the network off"). `initialQr` is whatever the Server
 * Component fetched for the current render; on mount this prefers a
 * still-valid IndexedDB cache over it, exactly the same reasoning
 * `voucher-detail-view.tsx`'s localStorage cache uses for the rest of the
 * voucher's details — a cache write always follows a successful fetch, so a
 * later offline visit within the cached hour renders the real rotating
 * token, not a stale server prop.
 */
export function useVoucherQrRotation(
  voucherId: string,
  initialQr: WalletQrDetail,
  nowProvider: () => number = Date.now,
): VoucherQrRotationState {
  const [windows, setWindows] = useState<QrWindow[]>(() => windowsOf(initialQr));
  const [nowMs, setNowMs] = useState(nowProvider);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const refreshAttempted = useRef(false);

  // Cache-first on mount: a fresher (or equal) cached batch beats the
  // server-rendered prop, and a first-ever visit seeds the cache from it.
  useEffect(() => {
    let cancelled = false;
    void readCachedQrWindows(voucherId).then((cached) => {
      if (cancelled) return;
      const initial = windowsOf(initialQr);
      if (cached === null) {
        void writeCachedQrWindows({
          voucherId,
          windows: initial,
          cachedAt: new Date().toISOString(),
        });
        return;
      }
      const cachedWindows = cached.windows;
      const cachedLast = cachedWindows.at(-1);
      const initialLast = initial.at(-1);
      const cachedIsFresher =
        cachedLast !== undefined &&
        initialLast !== undefined &&
        new Date(cachedLast.expiresAt).getTime() >= new Date(initialLast.expiresAt).getTime();
      if (cachedIsFresher) {
        setWindows(cachedWindows);
      } else {
        void writeCachedQrWindows({
          voucherId,
          windows: initial,
          cachedAt: new Date().toISOString(),
        });
      }
    });
    return () => {
      cancelled = true;
    };
    // Only re-runs for a different voucher; `initialQr` is a fresh object
    // reference every render but must not restart this cache read.
    // (`initialQr` is intentionally excluded from the dependency array.)
  }, [voucherId]);

  // Re-arms a fresh setTimeout every tick — same pattern as
  // checkpoint/use-question-timer.ts and this feature's old rotation hook.
  useEffect(() => {
    const timeoutId = window.setTimeout(() => setNowMs(nowProvider()), 1000);
    return () => window.clearTimeout(timeoutId);
  }, [nowMs, nowProvider]);

  const state = selectQrWindow(windows, nowMs);

  // Once every cached window has rotated past, try one live refresh — if
  // that fails (still offline, or the wallet API is down), stay exhausted
  // and let the caller fall back to the static code.
  useEffect(() => {
    if (!state.exhausted || refreshAttempted.current) return;
    refreshAttempted.current = true;
    void refreshVoucherQrAction(voucherId).then((result) => {
      if (result.ok) {
        const fresh = windowsOf(result.qr);
        setWindows(fresh);
        setRefreshFailed(false);
        refreshAttempted.current = false;
        void writeCachedQrWindows({
          voucherId,
          windows: fresh,
          cachedAt: new Date().toISOString(),
        });
      } else {
        setRefreshFailed(true);
      }
    });
  }, [state.exhausted, voucherId]);

  return { ...state, refreshFailed };
}
