"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

export interface VoucherQrCanvasProps {
  payload: string;
  label: string;
}

/**
 * The only file in this feature that imports "qrcode" — mirrors
 * apps/web/features/player/hls-attacher.tsx's rule for hls.js. Nothing
 * else references this module directly; `voucher-qr-code.tsx` reaches it
 * exclusively through `next/dynamic(() => import("./voucher-qr-canvas"), {
 * ssr: false })`, which is what actually splits the ~30 KB gz `qrcode`
 * chunk out of `/wallet/voucher/[voucherId]`'s initial JS
 * (docs/13b-typescript-standards.md §8).
 *
 * Regenerating the image on every `payload` change is the whole point —
 * `payload` changes each rotation window, and the new QR must render.
 */
export function VoucherQrCanvas({ payload, label }: VoucherQrCanvasProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    QRCode.toDataURL(payload, { margin: 1, width: 240 })
      .then((url) => {
        if (!cancelled) {
          setDataUrl(url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [payload]);

  if (failed) {
    return (
      <div className="flex h-60 w-60 items-center justify-center rounded-lg border border-dashed border-border p-4 text-center text-xs text-fg-muted">
        Kode QR gagal dibuat. Tunjukkan kode voucher secara manual ke kasir.
      </div>
    );
  }

  if (!dataUrl) {
    return (
      <div aria-hidden="true" className="h-60 w-60 animate-pulse rounded-lg bg-surface-raised" />
    );
  }

  return (
    <img
      src={dataUrl}
      alt={label}
      width={240}
      height={240}
      className="h-60 w-60 rounded-lg border border-border"
    />
  );
}
