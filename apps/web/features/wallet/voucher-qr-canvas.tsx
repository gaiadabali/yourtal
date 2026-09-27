"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { QRPanel } from "@yourtal/ui/qr-panel";

export interface VoucherQrCanvasProps {
  payload: string;
  label: string;
  /** The human-typeable fallback shown under the QR image, per `QRPanel`. */
  code: string;
  caption?: string | undefined;
  /** 6.1.d: translated copy for the "QR failed to render" fallback — never hard-coded here. */
  fallbackLabel: string;
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
export function VoucherQrCanvas({ payload, label, code, caption, fallbackLabel }: VoucherQrCanvasProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setDataUrl(null);
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

  return (
    <QRPanel src={dataUrl ?? undefined} alt={label} code={code} caption={failed ? fallbackLabel : caption}>
      {dataUrl || failed ? null : (
        <div aria-hidden="true" className="size-44 animate-pulse rounded-control bg-surface-sunken" />
      )}
    </QRPanel>
  );
}
