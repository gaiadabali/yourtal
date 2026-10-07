"use client";

import { useEffect, useState } from "react";
import { revealVoucherCodeAction } from "./reveal-voucher-code-action";

/**
 * The manual redemption code, held in component state only: never written to
 * localStorage, IndexedDB or any cache (docs/15 rule 7). Fetched once per
 * visit while the voucher is redeemable and the browser is online; offline,
 * or on any failure, it stays `undefined` and the screen falls back to the QR.
 */
export function useVoucherCode(voucherId: string, enabled: boolean): string | undefined {
  const [code, setCode] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!enabled) {
      setCode(undefined);
      return;
    }
    let cancelled = false;
    revealVoucherCodeAction(voucherId)
      .then((result) => {
        if (!cancelled && result.ok) setCode(result.code);
      })
      .catch(() => {
        // Offline or the action failed: the QR is the way in.
      });
    return () => {
      cancelled = true;
    };
  }, [voucherId, enabled]);

  return code;
}
