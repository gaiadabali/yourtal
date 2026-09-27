"use client";

import { useState } from "react";
import type { CounterVoucherPreview } from "@yourtal/contracts/device/counter-redemption";
import { Button } from "@yourtal/ui/button";
import { Input } from "@yourtal/ui/input";
import { MerchantVoucherSummary } from "./merchant-voucher-summary";
import type { MerchantCopy } from "./merchant-i18n";

export interface MerchantReviewFormProps {
  preview: CounterVoucherPreview;
  amountMinor: number;
  effectiveRemainingMinor: number;
  copy: MerchantCopy;
  onAmountChange: (amountMinor: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Tap 2 of "enter a code, confirm, done, in two taps": the amount defaults
 * to the voucher's full remaining value (a full-value redemption needs no
 * typing at all, just a tap on "Confirm redemption"), editable for a
 * genuine partial spend. Large touch targets throughout — this is a
 * shared, standing-up shop device, not a desk.
 */
export function MerchantReviewForm({
  preview,
  amountMinor,
  effectiveRemainingMinor,
  copy,
  onAmountChange,
  onConfirm,
  onCancel,
}: MerchantReviewFormProps) {
  const [amountText, setAmountText] = useState(String(amountMinor));

  function handleAmountInput(value: string) {
    setAmountText(value);
    const parsed = Number.parseInt(value, 10);
    onAmountChange(Number.isFinite(parsed) ? parsed : 0);
  }

  return (
    <div className="flex flex-col gap-4">
      <MerchantVoucherSummary
        preview={preview}
        effectiveRemainingMinor={effectiveRemainingMinor}
        copy={copy}
      />
      <Input
        label={copy.amountLabel}
        helpText={copy.amountHelp}
        inputMode="numeric"
        type="number"
        min={0}
        max={effectiveRemainingMinor}
        value={amountText}
        onChange={(event) => handleAmountInput(event.target.value)}
        className="h-14 text-2xl font-semibold tabular-nums"
      />
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
        <Button type="button" size="lg" onClick={onConfirm} className="h-14 flex-[2] text-base">
          {copy.confirmButton}
        </Button>
      </div>
    </div>
  );
}
