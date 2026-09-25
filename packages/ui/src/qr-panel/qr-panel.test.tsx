import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QRPanel } from "./qr-panel";

describe("QRPanel", () => {
  it("renders the QR image with its required alt text, the code and a caption", () => {
    render(
      <QRPanel
        src="data:image/png;base64,abc"
        alt="QR code for voucher ABC123"
        code="ABC123"
        caption="Show this at the counter"
      />,
    );
    expect(screen.getByAltText("QR code for voucher ABC123")).toBeInTheDocument();
    expect(screen.getByText("ABC123")).toBeInTheDocument();
    expect(screen.getByText("Show this at the counter")).toBeInTheDocument();
  });

  it("accepts children instead of src and still exposes an accessible name", () => {
    render(
      <QRPanel alt="QR code for voucher XYZ789" code="XYZ789">
        <svg aria-hidden="true" />
      </QRPanel>,
    );
    expect(screen.getByRole("img", { name: "QR code for voucher XYZ789" })).toBeInTheDocument();
  });

  it("omits the caption when none is given", () => {
    render(<QRPanel src="data:image/png;base64,abc" alt="QR code" code="CODE1" />);
    expect(screen.queryByText(/show this/i)).not.toBeInTheDocument();
  });
});
