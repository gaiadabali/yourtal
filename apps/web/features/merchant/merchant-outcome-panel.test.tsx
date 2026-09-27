import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { toMinorUnits } from "@yourtal/contracts/money";
import { getMerchantCopy } from "./merchant-i18n";
import { MerchantOutcomePanel } from "./merchant-outcome-panel";
import type { MerchantOutcome } from "./merchant-outcome-panel";

const copy = getMerchantCopy("en-AU");

function renderOutcome(
  outcome: MerchantOutcome,
  handlers: Partial<{
    onRetry: () => void;
    onEditAmount: () => void;
    onNewRedemption: () => void;
  }> = {},
) {
  return render(
    <MerchantOutcomePanel
      outcome={outcome}
      locale="en-AU"
      currency="AUD"
      copy={copy}
      onRetry={handlers.onRetry ?? vi.fn()}
      onEditAmount={handlers.onEditAmount ?? vi.fn()}
      onNewRedemption={handlers.onNewRedemption ?? vi.fn()}
    />,
  );
}

describe("MerchantOutcomePanel", () => {
  it("renders a success receipt as role=status, never role=alert", () => {
    renderOutcome({
      kind: "success",
      capture: {
        captureId: "rcpt_1",
        voucherId: "00000000-0000-4000-8000-000000000001",
        amountMinor: toMinorUnits(20_000),
        currency: "AUD",
        capturedAt: "2026-09-19T09:00:00.000Z",
        orderRef: "ORDER-1",
      },
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Redeemed")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders offline as role=alert, distinct wording from success, and never claims success", () => {
    renderOutcome({ kind: "offline" });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Can't redeem offline")).toBeInTheDocument();
    expect(screen.queryByText("Redeemed")).not.toBeInTheDocument();
  });

  it("renders a failure as role=alert with a specific message and the right recovery action", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderOutcome({ kind: "failed", error: { code: "network_error" } }, { onRetry });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    const retryButton = screen.getByRole("button", { name: copy.tryAgainButton });
    await user.click(retryButton);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("offers edit_amount recovery for an amount-shaped error", () => {
    const onEditAmount = vi.fn();
    renderOutcome(
      {
        kind: "failed",
        error: { code: "amount_exceeds_remaining_value", remainingValueMinor: 1_000 },
      },
      { onEditAmount },
    );
    expect(screen.getByRole("button", { name: copy.backButton })).toBeInTheDocument();
  });

  it("offers new_redemption recovery for a fact-about-the-voucher error", () => {
    renderOutcome({ kind: "failed", error: { code: "already_redeemed" } });
    expect(screen.getByRole("button", { name: copy.newRedemptionButton })).toBeInTheDocument();
  });
});
