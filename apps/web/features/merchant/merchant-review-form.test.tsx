import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CounterVoucherPreview } from "@yourtal/contracts/device/counter-redemption";
import { rupiah, toMinorUnits } from "@yourtal/contracts/money";
import { getMerchantCopy } from "./merchant-i18n";
import { MerchantReviewForm } from "./merchant-review-form";

const copy = getMerchantCopy("en-AU");

const idrPreview: CounterVoucherPreview = {
  voucherId: "00000000-0000-4000-8000-000000000101",
  merchantName: "Toko Berkah",
  offerTitle: "Voucher Toko Berkah",
  remainingValueMinor: rupiah(80_000),
  currency: "IDR",
  partialRedemptionPolicy: "balance_carrying",
};

const audPreview: CounterVoucherPreview = {
  ...idrPreview,
  remainingValueMinor: toMinorUnits(1000),
  currency: "AUD",
};

function renderForm(
  preview: CounterVoucherPreview,
  options: { locale?: "en-AU" | "id-ID"; amountMinor?: number | null } = {},
) {
  const onContinue = vi.fn();
  const onCancel = vi.fn();
  const locale = options.locale ?? "en-AU";
  render(
    <MerchantReviewForm
      preview={preview}
      amountMinor={options.amountMinor ?? null}
      effectiveRemainingMinor={preview.remainingValueMinor}
      copy={getMerchantCopy(locale)}
      locale={locale}
      onContinue={onContinue}
      onCancel={onCancel}
    />,
  );
  return { onContinue, onCancel };
}

describe("MerchantReviewForm", () => {
  it("starts empty with the currency in the label, never a prefilled count of cents", () => {
    renderForm(audPreview);
    // The old screen showed "1000" for a $10.00 voucher: 1000 cents with no unit.
    expect(screen.getByLabelText("Amount to redeem (AUD)")).toHaveValue("");
    expect(screen.queryByDisplayValue("1000")).not.toBeInTheDocument();
  });

  it("passes dollars on as exact cents: 4.50 is 450, not 4", async () => {
    const { onContinue } = renderForm(audPreview);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Amount to redeem (AUD)"), "4.50");
    await user.click(screen.getByRole("button", { name: copy.continueButton }));
    expect(onContinue).toHaveBeenCalledWith(450);
  });

  it("shows the amount it was given back in dollars when returning from the review", () => {
    renderForm(audPreview, { amountMinor: 450 });
    expect(screen.getByLabelText("Amount to redeem (AUD)")).toHaveValue("4.50");
  });

  it("refuses more than the balance and says what is left", async () => {
    const { onContinue } = renderForm(audPreview);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Amount to redeem (AUD)"), "10.01");
    await user.click(screen.getByRole("button", { name: copy.continueButton }));
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("only has $10.00 left");
  });

  it.each([
    ["", /Enter the amount/u],
    ["0", /above zero/u],
    ["abc", /isn't an amount/u],
    ["4.505", /at most 2 decimal places/u],
  ])("refuses %j in words", async (typed, message) => {
    const { onContinue } = renderForm(audPreview);
    const user = userEvent.setup();
    if (typed) await user.type(screen.getByLabelText("Amount to redeem (AUD)"), typed);
    await user.click(screen.getByRole("button", { name: copy.continueButton }));
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(message);
  });

  it("takes whole rupiah, grouped the Indonesian way", async () => {
    const { onContinue } = renderForm(idrPreview, { locale: "id-ID" });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Jumlah yang dipakai (IDR)"), "25.000");
    await user.click(screen.getByRole("button", { name: "Tinjau" }));
    expect(onContinue).toHaveBeenCalledWith(25_000);
  });

  it("refuses a decimal rupiah amount", async () => {
    const { onContinue } = renderForm(idrPreview, { locale: "id-ID" });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Jumlah yang dipakai (IDR)"), "250,5");
    await user.click(screen.getByRole("button", { name: "Tinjau" }));
    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("tanpa desimal");
  });

  it("fills the whole balance on request, without continuing by itself", async () => {
    const { onContinue } = renderForm(audPreview);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Use the full balance ($10.00)" }));
    expect(screen.getByLabelText("Amount to redeem (AUD)")).toHaveValue("10.00");
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("goes back without continuing", async () => {
    const { onCancel, onContinue } = renderForm(audPreview);
    await userEvent.setup().click(screen.getByRole("button", { name: copy.backButton }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onContinue).not.toHaveBeenCalled();
  });
});
