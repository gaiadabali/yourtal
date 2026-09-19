"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@yourtal/ui/skeleton";

const VoucherQrCanvas = dynamic(
  () => import("./voucher-qr-canvas").then((qrModule) => qrModule.VoucherQrCanvas),
  {
    ssr: false,
    loading: () => <Skeleton className="h-60 w-60 rounded-lg" />,
  },
);

export interface VoucherQrCodeProps {
  payload: string;
  label: string;
}

/**
 * The only place `voucher-qr-canvas.tsx` (and therefore the `qrcode`
 * package) is referenced. `next/dynamic({ ssr: false })` is what actually
 * code-splits that module — it is fetched only once this component mounts,
 * never bundled into `/wallet/voucher/[voucherId]`'s initial JS
 * (docs/13b-typescript-standards.md §8; the YT-0424 brief's "qrcode is
 * heavy... never in the initial chunk").
 */
export function VoucherQrCode({ payload, label }: VoucherQrCodeProps) {
  return <VoucherQrCanvas payload={payload} label={label} />;
}
