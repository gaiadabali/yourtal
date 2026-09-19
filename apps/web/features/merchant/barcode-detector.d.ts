// Minimal ambient types for the native Barcode Detection API
// (https://developer.mozilla.org/en-US/docs/Web/API/Barcode_Detection_API).
// Not part of TypeScript's bundled `DOM` lib as of the version pinned in
// packages/tsconfig, so `merchant-qr-scanner-camera.tsx` would otherwise
// need `any`/casts to reference it — banned outright by
// docs/13b-typescript-standards.md §2. Chrome, Edge and Android WebView
// support it; Safari and Firefox do not. Every call site feature-detects
// `window.BarcodeDetector` before touching this, so an ambient type that
// is too narrow (or wrong once the real spec lands in `lib.dom.d.ts`) can
// only ever make the check unnecessarily conservative, never cause a
// false-positive construction on a browser that lacks it.
interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorOptions {
  formats?: string[];
}

declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions);
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}

interface Window {
  BarcodeDetector?: typeof BarcodeDetector;
}
