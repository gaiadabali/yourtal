"use client";

import { useEffect, useState } from "react";
import { revealVoucherCodeAction } from "./reveal-voucher-code-action";

/**
 * The manual redemption code, held in component state only: never written to
 * localStorage, IndexedDB or any cache (docs/15 rule 7). Fetched once per
 * visit while the voucher is redeemable and the browser is online; offline,
 * or on any failure, it settles on `null` (`undefined` means still loading) and the screen falls back to the QR.
 */
export function useVoucherCode(voucherId: string, enabled: boolean): string | null | undefined {
  const [code, setCode] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!enabled) {
      setCode(null);
      return;
    }
    let cancelled = false;
    revealVoucherCodeAction(voucherId)
      .then((result) => {
        if (!cancelled) setCode(result.ok ? result.code : null);
      })
      .catch(() => {
        // Offline or the action failed: the QR is the way in.
        if (!cancelled) setCode(null);
      });
    return () => {
      cancelled = true;
    };
  }, [voucherId, enabled]);

  return code;
}
