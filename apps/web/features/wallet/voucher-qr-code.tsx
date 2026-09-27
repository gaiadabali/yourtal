"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@yourtal/ui/skeleton";

const VoucherQrCanvas = dynamic(
  () => import("./voucher-qr-canvas").then((qrModule) => qrModule.VoucherQrCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-col items-center gap-3 rounded-card border border-border-subtle bg-surface p-5">
        <Skeleton className="size-44 rounded-control" />
        <Skeleton className="h-5 w-32" />
      </div>
    ),
  },
);

export interface VoucherQrCodeProps {
  payload: string;
  label: string;
  code: string;
  caption?: string | undefined;
  fallbackLabel: string;
}

/**
 * The only place `voucher-qr-canvas.tsx` (and therefore the `qrcode`
 * package) is referenced. `next/dynamic({ ssr: false })` is what actually
 * code-splits that module — it is fetched only once this component mounts,
 * never bundled into `/wallet/voucher/[voucherId]`'s initial JS
 * (docs/13b-typescript-standards.md §8; the YT-0424 brief's "qrcode is
 * heavy... never in the initial chunk").
 */
export function VoucherQrCode({
  payload,
  label,
  code,
  caption,
  fallbackLabel,
}: VoucherQrCodeProps) {
  return (
    <VoucherQrCanvas
      payload={payload}
      label={label}
      code={code}
      caption={caption}
      fallbackLabel={fallbackLabel}
    />
  );
}
