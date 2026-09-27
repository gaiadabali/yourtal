import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { VoucherQrCanvas } from "./voucher-qr-canvas";

/**
 * jsdom has no real `<canvas>` rendering, so the real `qrcode` package
 * cannot draw an actual QR symbol in this test environment. Mocked here to
 * a deterministic `toDataURL` so this test can assert on the component's
 * own behaviour (calls the encoder with the exact payload, shows a loading
 * placeholder first, then the image) rather than on canvas internals.
 */
const toDataURLMock = vi.fn<(text: string, options?: unknown) => Promise<string>>();
vi.mock("qrcode", () => ({
  default: { toDataURL: (text: string, options?: unknown) => toDataURLMock(text, options) },
}));

const baseProps = {
  label: "Redemption QR code for Kopi Sentosa",
  code: "AB12CD",
  fallbackLabel: "Show the voucher code to the cashier instead.",
};

describe("VoucherQrCanvas", () => {
  it("encodes the exact payload it was given", async () => {
    toDataURLMock.mockResolvedValue("data:image/png;base64,FAKE");
    render(<VoucherQrCanvas payload="signed-token-1" {...baseProps} />);

    await waitFor(() =>
      expect(toDataURLMock).toHaveBeenCalledWith("signed-token-1", expect.anything()),
    );
  });

  it("renders the QR image with the given accessible label and the manual code, once generation resolves", async () => {
    toDataURLMock.mockResolvedValue("data:image/png;base64,FAKE");
    render(<VoucherQrCanvas payload="signed-token-1" {...baseProps} />);

    // `findByRole` alone can resolve too early: while generation is
    // pending, `QRPanel` itself already renders a `role="img"` wrapper
    // (its custom-child-renderer fallback) with the SAME accessible name
    // as the eventual `<img>` — so the assertion must wait for the actual
    // image element, not just any element matching that role/name.
    await waitFor(() =>
      expect(screen.getByRole("img", { name: baseProps.label })).toHaveAttribute(
        "src",
        "data:image/png;base64,FAKE",
      ),
    );
    expect(screen.getByText("AB12CD")).toBeInTheDocument();
  });

  it("regenerates the image when the payload rotates", async () => {
    toDataURLMock.mockResolvedValue("data:image/png;base64,FIRST");
    const { rerender } = render(<VoucherQrCanvas payload="signed-token-1" {...baseProps} />);
    await screen.findByRole("img", { name: baseProps.label });

    toDataURLMock.mockResolvedValue("data:image/png;base64,SECOND");
    rerender(<VoucherQrCanvas payload="signed-token-2" {...baseProps} />);

    await waitFor(() =>
      expect(screen.getByRole("img", { name: baseProps.label })).toHaveAttribute(
        "src",
        "data:image/png;base64,SECOND",
      ),
    );
  });

  it("falls back to the translated failure copy if QR generation fails, instead of crashing", async () => {
    toDataURLMock.mockRejectedValue(new Error("encoding failed"));
    render(<VoucherQrCanvas payload="signed-token-1" {...baseProps} />);

    expect(await screen.findByText(baseProps.fallbackLabel)).toBeInTheDocument();
  });
});
