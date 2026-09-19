import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { getMerchantCopy } from "./merchant-copy";
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
      receipt: {
        authorizationId: "auth_1",
        receiptId: "rcpt_1",
        voucherId: "v1",
        voucherCode: "ABC12345",
        merchantName: "Toko Berkah",
        amountCapturedMinor: 20_000,
        remainingValueMinor: 30_000,
        capturedAt: "2026-09-19T09:00:00.000Z",
      },
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Redeemed")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders queued as role=status, distinct wording from success", () => {
    renderOutcome({
      kind: "queued",
      voucherCode: "ABC12345",
      amountMinor: 10_000,
      queuedAt: "2026-09-19T09:00:00.000Z",
    });
    expect(screen.getByText("Waiting for connection")).toBeInTheDocument();
    expect(screen.getByText(/has not succeeded yet/i)).toBeInTheDocument();
    expect(screen.queryByText("Redeemed")).not.toBeInTheDocument();
  });

  it("renders a failure as role=alert with a specific message and the right recovery action", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderOutcome({ kind: "failed", error: { type: "network_error" } }, { onRetry });
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
        error: { type: "amount_exceeds_remaining_value", remainingValueMinor: 1_000 },
      },
      { onEditAmount },
    );
    expect(screen.getByRole("button", { name: copy.backButton })).toBeInTheDocument();
  });

  it("offers new_redemption recovery for a fact-about-the-voucher error", () => {
    renderOutcome({ kind: "failed", error: { type: "already_redeemed" } });
    expect(screen.getByRole("button", { name: copy.newRedemptionButton })).toBeInTheDocument();
  });
});
