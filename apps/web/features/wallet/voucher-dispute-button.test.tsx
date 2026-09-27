import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import enAU from "@/messages/en-AU/wallet.json";
import { VoucherDisputeButton } from "./voucher-dispute-button";

const { disputeVoucherActionMock } = vi.hoisted(() => ({ disputeVoucherActionMock: vi.fn() }));
vi.mock("./dispute-voucher-action", () => ({ disputeVoucherAction: disputeVoucherActionMock }));

function renderButton(onResolved = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en-AU" messages={{ wallet: enAU }}>
      <VoucherDisputeButton voucherId="voucher-1" onResolved={onResolved} />
    </NextIntlClientProvider>,
  );
  return onResolved;
}

describe("VoucherDisputeButton", () => {
  it("opens a dialog with the closed list of reasons, defaulting to 'not honoured'", async () => {
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole("button", { name: "This voucher didn't work" }));

    expect(screen.getByRole("radio", { name: "The merchant wouldn't accept it" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "The merchant was closed" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Something else" })).not.toBeChecked();
  });

  it("submits the selected reason and reports the reinstated outcome", async () => {
    disputeVoucherActionMock.mockResolvedValue({
      ok: true,
      result: { voucherId: "voucher-1", outcome: "reinstated", points: 500 },
    });
    const user = userEvent.setup();
    const onResolved = renderButton();

    await user.click(screen.getByRole("button", { name: "This voucher didn't work" }));
    await user.click(screen.getByRole("radio", { name: "The merchant was closed" }));
    await user.click(screen.getByRole("button", { name: "Send report" }));

    await waitFor(() =>
      expect(disputeVoucherActionMock).toHaveBeenCalledWith("voucher-1", "merchant_closed"),
    );
    await waitFor(() =>
      expect(onResolved).toHaveBeenCalledWith({
        ok: true,
        result: { voucherId: "voucher-1", outcome: "reinstated", points: 500 },
      }),
    );
  });

  it("reports a failed submission without throwing", async () => {
    disputeVoucherActionMock.mockResolvedValue({
      ok: false,
      error: { kind: "network", message: "offline" },
    });
    const user = userEvent.setup();
    const onResolved = renderButton();

    await user.click(screen.getByRole("button", { name: "This voucher didn't work" }));
    await user.click(screen.getByRole("button", { name: "Send report" }));

    await waitFor(() => expect(onResolved).toHaveBeenCalledWith({ ok: false }));
  });
});
