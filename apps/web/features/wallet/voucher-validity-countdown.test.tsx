import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { VoucherValidityCountdown } from "./voucher-validity-countdown";

describe("VoucherValidityCountdown", () => {
  it("exposes an accessible progressbar with the correct current/max values", () => {
    render(<VoucherValidityCountdown secondsUntilRotation={12} rotationIntervalSeconds={30} />);

    const progressbar = screen.getByRole("progressbar", { name: "Waktu sebelum kode QR diperbarui" });
    expect(progressbar).toHaveAttribute("aria-valuenow", "12");
    expect(progressbar).toHaveAttribute("aria-valuemax", "30");
  });

  it("shows the remaining seconds as visible text", () => {
    render(<VoucherValidityCountdown secondsUntilRotation={7} rotationIntervalSeconds={30} />);

    expect(screen.getByText("7 detik lagi")).toBeInTheDocument();
  });

  it("clamps a stale negative or over-range value instead of rendering nonsense", () => {
    render(<VoucherValidityCountdown secondsUntilRotation={-2} rotationIntervalSeconds={30} />);

    const progressbar = screen.getByRole("progressbar");
    expect(progressbar).toHaveAttribute("aria-valuenow", "0");
  });
});
