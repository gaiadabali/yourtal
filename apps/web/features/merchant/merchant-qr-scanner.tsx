"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@yourtal/ui/skeleton";
import type { MerchantQrScannerCameraProps } from "./merchant-qr-scanner-camera";

const MerchantQrScannerCamera = dynamic(
  () =>
    import("./merchant-qr-scanner-camera").then(
      (cameraModule) => cameraModule.MerchantQrScannerCamera,
    ),
  { ssr: false, loading: () => <Skeleton className="aspect-square w-full rounded-lg" /> },
);

export type MerchantQrScannerProps = MerchantQrScannerCameraProps;

/**
 * The only place `merchant-qr-scanner-camera.tsx` is referenced.
 * `next/dynamic({ ssr: false })` code-splits the camera/BarcodeDetector
 * module out of `/merchant`'s initial JS entirely — it is fetched only
 * once this component mounts, which `merchant-identify-panel.tsx` ensures
 * happens only once staff select the "Scan" tab (loaded on intent, never
 * on page load), per docs/13b-typescript-standards.md §8.
 */
export function MerchantQrScanner(props: MerchantQrScannerProps) {
  return <MerchantQrScannerCamera {...props} />;
}
