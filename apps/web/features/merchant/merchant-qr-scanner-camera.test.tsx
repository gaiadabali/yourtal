import "@testing-library/jest-dom/vitest";
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MerchantQrScannerCamera } from "./merchant-qr-scanner-camera";

/**
 * jsdom has neither `BarcodeDetector` nor a real camera — this ticket's
 * brief is explicit that "jsdom cannot test any of it" for the actual
 * decode path. What IS testable, and matters just as much for honesty,
 * is that the component never leaves staff staring at a dead camera
 * preview: on every browser this test environment represents (no
 * `BarcodeDetector`), it must report `onUnavailable("unsupported")`
 * immediately, without ever prompting for camera permission it could not
 * use anyway.
 */
describe("MerchantQrScannerCamera", () => {
  afterEach(() => {
    delete (window as { BarcodeDetector?: unknown }).BarcodeDetector;
    vi.restoreAllMocks();
  });

  it("reports unsupported and never requests the camera when BarcodeDetector is absent", async () => {
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });
    const onUnavailable = vi.fn();
    const onDetect = vi.fn();

    render(
      <MerchantQrScannerCamera
        onDetect={onDetect}
        onUnavailable={onUnavailable}
        hint="Point the camera"
      />,
    );

    await waitFor(() => expect(onUnavailable).toHaveBeenCalledWith("unsupported"));
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(onDetect).not.toHaveBeenCalled();
  });

  it("reports unsupported when getUserMedia itself is unavailable, even if BarcodeDetector exists", async () => {
    (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = class {
      detect() {
        return Promise.resolve([]);
      }
    };
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    const onUnavailable = vi.fn();

    render(
      <MerchantQrScannerCamera
        onDetect={vi.fn()}
        onUnavailable={onUnavailable}
        hint="Point the camera"
      />,
    );

    await waitFor(() => expect(onUnavailable).toHaveBeenCalledWith("unsupported"));
  });

  it("reports permission_denied when getUserMedia rejects with NotAllowedError", async () => {
    (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = class {
      detect() {
        return Promise.resolve([]);
      }
    };
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });
    const onUnavailable = vi.fn();

    render(
      <MerchantQrScannerCamera
        onDetect={vi.fn()}
        onUnavailable={onUnavailable}
        hint="Point the camera"
      />,
    );

    await waitFor(() => expect(onUnavailable).toHaveBeenCalledWith("permission_denied"));
  });

  it("renders the given hint text", () => {
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    const { getByText } = render(
      <MerchantQrScannerCamera
        onDetect={vi.fn()}
        onUnavailable={vi.fn()}
        hint="Point the camera"
      />,
    );
    expect(getByText("Point the camera")).toBeInTheDocument();
  });
});
