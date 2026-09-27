import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CounterVoucherPreview } from "@yourtal/contracts/device/counter-redemption";
import { getMerchantCopy } from "./merchant-i18n";
import { MerchantReviewForm } from "./merchant-review-form";
import { rupiah } from "@yourtal/contracts/money";

const copy = getMerchantCopy("en-AU");

const preview: CounterVoucherPreview = {
  voucherId: "00000000-0000-4000-8000-000000000101",
  merchantName: "Toko Berkah",
  offerTitle: "Voucher Toko Berkah",
  remainingValueMinor: rupiah(80_000),
  currency: "IDR",
  partialRedemptionPolicy: "balance_carrying",
};

describe("MerchantReviewForm", () => {
  it("defaults the amount to the full effective remaining value", () => {
    render(
      <MerchantReviewForm
        preview={preview}
        amountMinor={80_000}
        effectiveRemainingMinor={80_000}
        copy={copy}
        onAmountChange={vi.fn()}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(copy.amountLabel)).toHaveValue(80_000);
  });

  it("calls onConfirm when the confirm button is tapped — no extra step needed for the common case", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <MerchantReviewForm
        preview={preview}
        amountMinor={80_000}
        effectiveRemainingMinor={80_000}
        copy={copy}
        onAmountChange={vi.fn()}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: copy.confirmButton }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("reports an edited amount via onAmountChange", async () => {
    const user = userEvent.setup();
    const onAmountChange = vi.fn();
    render(
      <MerchantReviewForm
        preview={preview}
        amountMinor={80_000}
        effectiveRemainingMinor={80_000}
        copy={copy}
        onAmountChange={onAmountChange}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const input = screen.getByLabelText(copy.amountLabel);
    await user.clear(input);
    await user.type(input, "30000");
    expect(onAmountChange).toHaveBeenLastCalledWith(30_000);
  });

  it("calls onCancel from the back button", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <MerchantReviewForm
        preview={preview}
        amountMinor={80_000}
        effectiveRemainingMinor={80_000}
        copy={copy}
        onAmountChange={vi.fn()}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole("button", { name: copy.backButton }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
