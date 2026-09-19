import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Voucher } from "@yourtal/contracts/voucher";
import { getMerchantCopy } from "./merchant-copy";
import { MerchantReviewForm } from "./merchant-review-form";

const copy = getMerchantCopy("en-AU");

const voucher: Voucher = {
  id: "v1",
  listingId: "l1",
  ownerId: "o1",
  code: "GOODCODE1",
  merchantName: "Toko Berkah",
  title: "Voucher Toko Berkah",
  faceValueIdr: 80_000,
  remainingValueIdr: 80_000,
  partialRedemptionPolicy: "balance_carrying",
  transferable: true,
  status: "active",
  issuedAt: "2026-09-01T00:00:00.000Z",
  expiresAt: "2026-12-01T00:00:00.000Z",
} as Voucher;

describe("MerchantReviewForm", () => {
  it("defaults the amount to the full effective remaining value", () => {
    render(
      <MerchantReviewForm
        voucher={voucher}
        amountMinor={80_000}
        effectiveRemainingMinor={80_000}
        locale="en-AU"
        currency="AUD"
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
        voucher={voucher}
        amountMinor={80_000}
        effectiveRemainingMinor={80_000}
        locale="en-AU"
        currency="AUD"
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
        voucher={voucher}
        amountMinor={80_000}
        effectiveRemainingMinor={80_000}
        locale="en-AU"
        currency="AUD"
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
        voucher={voucher}
        amountMinor={80_000}
        effectiveRemainingMinor={80_000}
        locale="en-AU"
        currency="AUD"
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
