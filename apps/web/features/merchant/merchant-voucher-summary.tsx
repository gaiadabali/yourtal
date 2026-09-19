import { formatMerchantMoney } from "./merchant-money";
import type { Voucher } from "@yourtal/contracts/voucher";
import { Badge } from "@yourtal/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import type { MerchantCopy } from "./merchant-copy";
import type { MerchantCurrency, MerchantLocale } from "./merchant-device";

export interface MerchantVoucherSummaryProps {
  voucher: Voucher;
  effectiveRemainingMinor: number;
  locale: MerchantLocale;
  currency: MerchantCurrency;
  copy: MerchantCopy;
}

const NEAR_EXPIRY_WINDOW_MS = 60 * 60 * 1000;

/**
 * The voucher review card — merchant name, code and remaining value in
 * large type (this ticket's "readable in bright light" brief), plus a
 * near-expiry warning when under an hour remains, so
 * `expiringWithinHourVoucherFixture` renders as a visible, legible edge
 * case rather than an indistinguishable "active" voucher (the brief: this
 * fixture and `expiredVoucherFixture` "are built to break assumptions").
 */
export function MerchantVoucherSummary({
  voucher,
  effectiveRemainingMinor,
  locale,
  currency,
  copy,
}: MerchantVoucherSummaryProps) {
  const msUntilExpiry = new Date(voucher.expiresAt).getTime() - Date.now();
  const isNearExpiry = msUntilExpiry > 0 && msUntilExpiry <= NEAR_EXPIRY_WINDOW_MS;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{voucher.merchantName}</CardTitle>
        <p className="font-mono text-lg tracking-wide text-fg-muted">{voucher.code}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-sans text-fg-muted">{voucher.title}</span>
          <span className="text-2xl font-sans font-semibold tabular-nums text-fg">
            {formatMerchantMoney(effectiveRemainingMinor, currency)}
          </span>
        </div>
        {isNearExpiry ? (
          <Badge variant="warning" className="w-fit">
            {formatExpiryWarning(voucher.expiresAt, locale)}
          </Badge>
        ) : null}
        {voucher.partialRedemptionPolicy === "minimum_spend" ? (
          <p className="text-xs font-sans text-fg-subtle">{copy.amountHelp}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function formatExpiryWarning(expiresAt: string, locale: MerchantLocale): string {
  const minutesLeft = Math.max(
    0,
    Math.round((new Date(expiresAt).getTime() - Date.now()) / 60_000),
  );
  return locale === "id-ID"
    ? `Kedaluwarsa dalam ${minutesLeft} menit`
    : `Expires in ${minutesLeft} min`;
}
