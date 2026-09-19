import Link from "next/link";
import type { Route } from "next";
import type { Voucher } from "@yourtal/contracts/voucher";
import { formatMoney } from "@yourtal/contracts/money/format";
import { Badge } from "@yourtal/ui/badge";
import { Card, CardContent } from "@yourtal/ui/card";
import { describeVoucherStatus, isVoucherEffectivelyExpired } from "./wallet-voucher-status-copy";
import { formatWalletDate } from "./wallet-format";
import { getWalletTranslator, type SupportedLocale } from "./wallet-i18n";

type SupportedCurrency = "AUD" | "IDR";

export interface WalletVoucherCardProps {
  voucher: Voucher;
  nowMs: number;
  /** YT-0405: both default so existing callers render exactly as before. */
  locale?: SupportedLocale;
  currency?: SupportedCurrency;
}

/**
 * One voucher card in the Wallet's voucher list. Archived vouchers (used,
 * expired, transferred, or expired-by-wall-clock) render visually distinct
 * — reduced emphasis, a status badge — but never disappear
 * (YT-0424: "archived and still viewable").
 */
export function WalletVoucherCard({
  voucher,
  nowMs,
  locale = "id-ID",
  currency = "IDR",
}: WalletVoucherCardProps) {
  const expired = isVoucherEffectivelyExpired(voucher, nowMs);
  const statusCopy = describeVoucherStatus(voucher.status, expired, locale);
  const href = `/wallet/voucher/${voucher.id}` as Route;
  const t = getWalletTranslator(locale);

  return (
    <Card className={statusCopy.isArchived ? "opacity-70" : undefined}>
      <CardContent className="relative flex flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-fg-subtle">{voucher.merchantName}</p>
            <h3 className="text-sm font-semibold text-fg">
              <Link href={href} className="static after:absolute after:inset-0 after:content-['']">
                {voucher.title}
              </Link>
            </h3>
          </div>
          <Badge variant={statusCopy.badgeVariant}>{statusCopy.label}</Badge>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold text-price">
            {formatMoney(voucher.remainingValueIdr, currency)}
          </span>
          <span className="text-xs text-fg-subtle">
            {statusCopy.isArchived
              ? t("voucher.expiresOn", { date: formatWalletDate(voucher.expiresAt, locale) })
              : t("voucher.validUntilCard", { date: formatWalletDate(voucher.expiresAt, locale) })}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
