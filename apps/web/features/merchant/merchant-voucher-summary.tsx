import type { CounterVoucherPreview } from "@yourtal/contracts/device/counter-redemption";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { formatMerchantMoney } from "./merchant-money";
import type { MerchantCopy } from "./merchant-i18n";

export interface MerchantVoucherSummaryProps {
  preview: CounterVoucherPreview;
  effectiveRemainingMinor: number;
  copy: MerchantCopy;
}

/**
 * The voucher review card — merchant name, offer and remaining value in
 * large type (this ticket's "readable in bright light" brief).
 *
 * TASKS.md 8.2 REWRITE: this used to read a full consumer `Voucher` and
 * show its `code` and an expiry countdown. The server-shaped
 * `CounterVoucherPreview` (`@yourtal/contracts/device/counter-redemption`)
 * carries neither — the code was already consumed at lookup time, and
 * there is no expiry field on the preview — so both are dropped here
 * rather than faked.
 */
export function MerchantVoucherSummary({
  preview,
  effectiveRemainingMinor,
  copy,
}: MerchantVoucherSummaryProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{preview.merchantName}</CardTitle>
        <p className="text-sm font-sans text-fg-muted">{preview.offerTitle}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-sans text-fg-muted">{copy.remainingValueLabel}</span>
          <span className="text-2xl font-sans font-semibold tabular-nums text-fg">
            {formatMerchantMoney(effectiveRemainingMinor, preview.currency)}
          </span>
        </div>
        {preview.partialRedemptionPolicy === "single_use" ? (
          <p className="text-xs font-sans text-fg-subtle">{copy.amountHelp}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
