"use client";

import { useState } from "react";
import type { SubmitEvent } from "react";
import type { CounterVoucherPreview } from "@yourtal/contracts/device/counter-redemption";
import { Button } from "@yourtal/ui/button";
import { Input } from "@yourtal/ui/input";
import { MerchantVoucherSummary } from "./merchant-voucher-summary";
import { currencyExponent, formatAmountForInput, parseAmountInput } from "./merchant-amount";
import type { MerchantLocale } from "./merchant-device";
import { getMerchantTranslator, type MerchantCopy } from "./merchant-i18n";
import { formatMerchantMoney } from "./merchant-money";

export interface MerchantReviewFormProps {
  preview: CounterVoucherPreview;
  /** What was typed before (coming back from the confirm step), in minor units. */
  amountMinor: number | null;
  effectiveRemainingMinor: number;
  copy: MerchantCopy;
  locale: MerchantLocale;
  /** A valid amount, in integer minor units, that the voucher can give. Nothing is committed yet. */
  onContinue: (amountMinor: number) => void;
  onCancel: () => void;
}

/** What a typed example looks like in this currency: 4.50 dollars, 25 000 rupiah. */
const EXAMPLE_MINOR = { AUD: 450, IDR: 25_000 } as const;

/**
 * Step 2 of a balance-carrying redemption: the cashier types the amount in
 * dollars (or rupiah), shown with its currency, and it is converted exactly to
 * integer minor units (`merchant-amount.ts`), never through a float. The field
 * starts empty, so a full-value redemption is a deliberate tap on "Use the
 * full balance" rather than a prefilled number to confirm unseen. A bad amount
 * (nothing, not a number, too many decimals, zero, over the balance) is
 * refused here, in words; a good one goes on to the confirm step.
 */
export function MerchantReviewForm({
  preview,
  amountMinor,
  effectiveRemainingMinor,
  copy,
  locale,
  onContinue,
  onCancel,
}: MerchantReviewFormProps) {
  const t = getMerchantTranslator(locale);
  const { currency } = preview;
  const [amountText, setAmountText] = useState(
    amountMinor === null ? "" : formatAmountForInput(amountMinor, currency, locale),
  );
  const [error, setError] = useState<string | null>(null);

  const remaining = formatMerchantMoney(effectiveRemainingMinor, currency, locale);
  const example = formatAmountForInput(EXAMPLE_MINOR[currency], currency, locale);

  function problemWith(text: string): { minor: number } | { message: string } {
    const parsed = parseAmountInput(text, currency, locale);
    if (!parsed.ok) {
      return {
        message:
          parsed.reason === "empty"
            ? t("portal.amountErrorEmpty")
            : parsed.reason === "too_precise"
              ? t("portal.amountErrorTooPrecise", { places: currencyExponent(currency) })
              : t("portal.amountErrorInvalid", { example }),
      };
    }
    if (parsed.amountMinor <= 0) {
      return { message: t("portal.amountErrorZero") };
    }
    if (parsed.amountMinor > effectiveRemainingMinor) {
      return { message: t("portal.amountErrorOver", { remaining }) };
    }
    return { minor: parsed.amountMinor };
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const outcome = problemWith(amountText);
    if ("message" in outcome) {
      setError(outcome.message);
      return;
    }
    setError(null);
    onContinue(outcome.minor);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <MerchantVoucherSummary
        preview={preview}
        effectiveRemainingMinor={effectiveRemainingMinor}
        copy={copy}
        locale={locale}
      />
      <Input
        label={t("portal.amountLabel", { currency })}
        helpText={copy.amountHelp}
        {...(error === null ? {} : { errorMessage: error })}
        inputMode="decimal"
        type="text"
        autoComplete="off"
        placeholder={formatAmountForInput(0, currency, locale)}
        value={amountText}
        onChange={(event) => {
          setAmountText(event.target.value);
          setError(null);
        }}
        className="h-14 text-2xl font-semibold tabular-nums"
      />
      <Button
        type="button"
        variant="secondary"
        size="lg"
        onClick={() => {
          setAmountText(formatAmountForInput(effectiveRemainingMinor, currency, locale));
          setError(null);
        }}
        className="h-12 text-base"
      >
        {t("portal.useFullBalance", { amount: remaining })}
      </Button>
      <div className="flex gap-3">
        <Button
          type="button"
          variant="secondary"
          size="lg"
          onClick={onCancel}
          className="h-14 flex-1 text-base"
        >
          {copy.backButton}
        </Button>
        <Button type="submit" size="lg" className="h-14 flex-[2] text-base">
          {copy.continueButton}
        </Button>
      </div>
    </form>
  );
}
