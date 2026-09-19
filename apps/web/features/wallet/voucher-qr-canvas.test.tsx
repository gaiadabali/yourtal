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

describe("VoucherQrCanvas", () => {
  it("encodes the exact payload it was given", async () => {
    toDataURLMock.mockResolvedValue("data:image/png;base64,FAKE");
    render(
      <VoucherQrCanvas payload="YT1.abc.1.TOKEN" label="Kode QR redeem voucher Kopi Sentosa" />,
    );

    await waitFor(() =>
      expect(toDataURLMock).toHaveBeenCalledWith("YT1.abc.1.TOKEN", expect.anything()),
    );
  });

  it("renders the QR image with the given accessible label once generation resolves", async () => {
    toDataURLMock.mockResolvedValue("data:image/png;base64,FAKE");
    render(
      <VoucherQrCanvas payload="YT1.abc.1.TOKEN" label="Kode QR redeem voucher Kopi Sentosa" />,
    );

    const img = await screen.findByRole("img", { name: "Kode QR redeem voucher Kopi Sentosa" });
    expect(img).toHaveAttribute("src", "data:image/png;base64,FAKE");
  });

  it("regenerates the image when the payload rotates", async () => {
    toDataURLMock.mockResolvedValue("data:image/png;base64,FIRST");
    const { rerender } = render(<VoucherQrCanvas payload="YT1.abc.1.TOKEN" label="Kode QR" />);
    await screen.findByRole("img", { name: "Kode QR" });

    toDataURLMock.mockResolvedValue("data:image/png;base64,SECOND");
    rerender(<VoucherQrCanvas payload="YT1.abc.2.TOKEN" label="Kode QR" />);

    await waitFor(() =>
      expect(screen.getByRole("img", { name: "Kode QR" })).toHaveAttribute(
        "src",
        "data:image/png;base64,SECOND",
      ),
    );
  });

  it("falls back to manual-code copy if QR generation fails, instead of crashing", async () => {
    toDataURLMock.mockRejectedValue(new Error("encoding failed"));
    render(<VoucherQrCanvas payload="YT1.abc.1.TOKEN" label="Kode QR" />);

    expect(await screen.findByText(/secara manual/)).toBeInTheDocument();
  });
});
