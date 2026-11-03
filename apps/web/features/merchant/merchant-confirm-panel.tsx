import type { CounterVoucherPreview } from "@yourtal/contracts/device/counter-redemption";
import { Button } from "@yourtal/ui/button";
import type { MerchantLocale } from "./merchant-device";
import { getMerchantTranslator, type MerchantCopy } from "./merchant-i18n";
import { formatMerchantMoney } from "./merchant-money";

export interface MerchantConfirmPanelProps {
  preview: CounterVoucherPreview;
  amountMinor: number;
  effectiveRemainingMinor: number;
  copy: MerchantCopy;
  locale: MerchantLocale;
  onConfirm: () => void;
  onBack: () => void;
}

/**
 * The review step every redemption passes through: "Redeem $4.50 of $10.00?"
 * with what stays on the voucher, and nothing committed until the cashier
 * confirms. For a single-use voucher it says the voucher can only be
 * redeemed whole, since there is no amount to choose.
 */
export function MerchantConfirmPanel({
  preview,
  amountMinor,
  effectiveRemainingMinor,
  copy,
  locale,
  onConfirm,
  onBack,
}: MerchantConfirmPanelProps) {
  const t = getMerchantTranslator(locale);
  const money = (minor: number) => formatMerchantMoney(minor, preview.currency, locale);
  const left = effectiveRemainingMinor - amountMinor;

  return (
    <section
      aria-labelledby="merchant-confirm-heading"
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-sans text-fg-muted">
          {preview.merchantName} · {preview.offerTitle}
        </p>
        <h2
          id="merchant-confirm-heading"
          className="text-2xl font-sans font-semibold tabular-nums text-fg"
        >
          {t("portal.confirmHeading", {
            amount: money(amountMinor),
            remaining: money(effectiveRemainingMinor),
          })}
        </h2>
      </div>
      <p className="text-sm font-sans text-fg-muted">
        {left > 0
          ? t("portal.confirmBodyPartial", { left: money(left) })
          : t("portal.confirmBodyFull")}
      </p>
      {preview.partialRedemptionPolicy === "single_use" ? (
        <p className="text-sm font-sans text-fg-muted">{t("portal.confirmSingleUse")}</p>
      ) : null}
      <div className="flex gap-3">
        <Button
          type="button"
          variant="secondary"
          size="lg"
          onClick={onBack}
          className="h-14 flex-1 text-base"
        >
          {copy.backButton}
        </Button>
        <Button type="button" size="lg" onClick={onConfirm} className="h-14 flex-[2] text-base">
          {copy.confirmButton}
        </Button>
      </div>
    </section>
  );
}
