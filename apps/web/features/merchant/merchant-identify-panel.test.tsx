import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { getMerchantCopy } from "./merchant-copy";
import { MerchantIdentifyPanel } from "./merchant-identify-panel";

const copy = getMerchantCopy("en-AU");

/**
 * The manual-entry path is this ticket's required first-class fallback —
 * these tests exercise it directly by switching tabs, without waiting on
 * the camera/BarcodeDetector path (jsdom cannot exercise real scanning;
 * see merchant-qr-scanner-camera.test.tsx for what IS covered there).
 */
describe("MerchantIdentifyPanel", () => {
  it("shows both the scan and manual-entry tabs, always, by accessible role", () => {
    render(<MerchantIdentifyPanel copy={copy} onSubmitCode={vi.fn()} onScanDetect={vi.fn()} />);
    expect(screen.getByRole("tab", { name: copy.tabScan })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: copy.tabManual })).toBeInTheDocument();
  });

  it("submits the trimmed manual code and looks it up on tap", async () => {
    const user = userEvent.setup();
    const onSubmitCode = vi.fn();
    render(
      <MerchantIdentifyPanel copy={copy} onSubmitCode={onSubmitCode} onScanDetect={vi.fn()} />,
    );

    await user.click(screen.getByRole("tab", { name: copy.tabManual }));
    await user.type(screen.getByLabelText(copy.manualCodeLabel), "  ab12cd34  ");
    await user.click(screen.getByRole("button", { name: copy.lookUpButton }));

    expect(onSubmitCode).toHaveBeenCalledWith("ab12cd34");
  });

  it("disables the look-up button until a code is entered", async () => {
    const user = userEvent.setup();
    render(<MerchantIdentifyPanel copy={copy} onSubmitCode={vi.fn()} onScanDetect={vi.fn()} />);

    await user.click(screen.getByRole("tab", { name: copy.tabManual }));
    expect(screen.getByRole("button", { name: copy.lookUpButton })).toBeDisabled();

    await user.type(screen.getByLabelText(copy.manualCodeLabel), "X");
    expect(screen.getByRole("button", { name: copy.lookUpButton })).toBeEnabled();
  });

  it("never submits a blank/whitespace-only code", async () => {
    const user = userEvent.setup();
    const onSubmitCode = vi.fn();
    render(
      <MerchantIdentifyPanel copy={copy} onSubmitCode={onSubmitCode} onScanDetect={vi.fn()} />,
    );

    await user.click(screen.getByRole("tab", { name: copy.tabManual }));
    await user.type(screen.getByLabelText(copy.manualCodeLabel), "   ");
    expect(screen.getByRole("button", { name: copy.lookUpButton })).toBeDisabled();
    expect(onSubmitCode).not.toHaveBeenCalled();
  });
});
