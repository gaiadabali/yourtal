"use client";

import { useEffect, useRef } from "react";

export type MerchantScannerUnavailableReason = "unsupported" | "permission_denied" | "no_camera";

export interface MerchantQrScannerCameraProps {
  onDetect: (raw: string) => void;
  onUnavailable: (reason: MerchantScannerUnavailableReason) => void;
  hint: string;
}

/**
 * The actual camera leaf — deliberately the ONLY file in this feature that
 * touches `getUserMedia`/`BarcodeDetector`. Reached exclusively through
 * `merchant-qr-scanner.tsx`'s `next/dynamic({ ssr: false })`, loaded on
 * intent (only once staff pick the "Scan" tab), per
 * docs/13b-typescript-standards.md §8's explicit naming of the QR scanner
 * for that treatment — same shape as
 * `apps/web/features/wallet/voucher-qr-canvas.tsx` for the `qrcode`
 * package.
 *
 * No QR-decoding LIBRARY is added here — `pnpm install` is out of scope
 * for this ticket, and the native Barcode Detection API (Chrome/Edge/
 * Android; see `barcode-detector.d.ts`) covers real decoding with zero
 * added bundle weight. Where it is unsupported (Safari, Firefox, and any
 * browser that denies camera permission or has no camera), this reports
 * `onUnavailable` immediately and never even prompts for permission it
 * cannot use — the caller falls back to manual entry, which is this
 * ticket's required first-class path, not a hidden one.
 */
export function MerchantQrScannerCamera({
  onDetect,
  onUnavailable,
  hint,
}: MerchantQrScannerCameraProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;

  useEffect(() => {
    // TS's bundled DOM lib treats `navigator.mediaDevices` and its
    // `getUserMedia` method as always present, but that is a types-only
    // assumption — insecure (non-HTTPS) origins and some older/restricted
    // browsers genuinely have it undefined at runtime, which is exactly
    // the case this feature-detection exists to catch before ever
    // prompting for a permission it could not use. YT-0445.
    /* eslint-disable @typescript-eslint/no-unnecessary-condition -- see above, YT-0445 */
    if (
      typeof window === "undefined" ||
      !window.BarcodeDetector ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      /* eslint-enable @typescript-eslint/no-unnecessary-condition */
      onUnavailableRef.current("unsupported");
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let frameId: number | null = null;
    const detector = new window.BarcodeDetector({ formats: ["qr_code"] });

    async function scanLoop(video: HTMLVideoElement) {
      if (cancelled) {
        return;
      }
      try {
        const codes = await detector.detect(video);
        const [first] = codes;
        if (first) {
          onDetectRef.current(first.rawValue);
          return;
        }
      } catch {
        // A transient decode error on one frame — keep scanning.
      }
      frameId = window.requestAnimationFrame(() => {
        void scanLoop(video);
      });
    }

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        const isPermissionDenied =
          error instanceof DOMException && error.name === "NotAllowedError";
        onUnavailableRef.current(isPermissionDenied ? "permission_denied" : "no_camera");
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) {
        return;
      }
      video.srcObject = stream;
      await video.play();
      frameId = window.requestAnimationFrame(() => {
        void scanLoop(video);
      });
    }

    void start();

    return () => {
      cancelled = true;
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <video
        ref={videoRef}
        muted
        playsInline
        aria-hidden="true"
        className="aspect-square w-full rounded-lg bg-fg object-cover"
      />
      <p role="status" aria-live="polite" className="text-center text-sm font-sans text-fg-muted">
        {hint}
      </p>
    </div>
  );
}
