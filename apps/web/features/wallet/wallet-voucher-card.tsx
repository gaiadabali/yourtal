import Link from "next/link";
import type { Route } from "next";
import type { Voucher } from "@yourtal/contracts/voucher";
import { formatMoney } from "@yourtal/contracts/money/format";
import { Badge } from "@yourtal/ui/badge";
import { Card, CardContent } from "@yourtal/ui/card";
import { cn } from "@yourtal/ui/cn";
import { describeVoucherStatus, isVoucherEffectivelyExpired } from "./wallet-voucher-status-copy";
import { formatWalletDate } from "./wallet-format";
import { getWalletTranslator, type SupportedLocale } from "./wallet-i18n";

export interface WalletVoucherCardProps {
  voucher: Voucher;
  nowMs: number;
  /** YT-0405: required, not defaulted — see `store-balance-notice.tsx`'s report for why. */
  locale: SupportedLocale;
}

/**
 * One voucher card in the Wallet's voucher list. Archived vouchers (used,
 * expired, transferred, or expired-by-wall-clock) render visually distinct
 * — reduced emphasis, a status badge — but never disappear
 * (YT-0424: "archived and still viewable"). The remaining value renders in
 * the VOUCHER's own currency (`voucher.currency`, YT-0513), never the
 * viewer's region — a voucher is a bearer instrument for a specific
 * region's economy and must display as such regardless of who is viewing.
 */
export function WalletVoucherCard({ voucher, nowMs, locale }: WalletVoucherCardProps) {
  const expired = isVoucherEffectivelyExpired(voucher, nowMs);
  const statusCopy = describeVoucherStatus(voucher.status, expired, locale);
  const href = `/wallet/voucher/${voucher.id}` as Route;
  const t = getWalletTranslator(locale);

  return (
    // min-w-0: this card is a direct grid item in WalletVoucherList's
    // grid-cols-1/sm:grid-cols-2 track. Without it, the header row's
    // unwrapped merchant/title text (below) can force the grid item's
    // content-based automatic minimum size wider than the track, pushing
    // the card past the viewport at narrow widths / 200% zoom (YT-0401).
    <Card className={cn("min-w-0", statusCopy.isArchived && "opacity-70")}>
      <CardContent className="relative flex flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          {/* min-w-0 lets this block shrink/wrap within the flex row
              instead of refusing to shrink below its content (same pattern
              as the /business select fix). */}
          <div className="min-w-0">
            <p className="truncate text-xs text-fg-subtle" title={voucher.merchantName}>
              {voucher.merchantName}
            </p>
            <h3 className="truncate text-sm font-semibold text-fg">
              <Link href={href} className="static after:absolute after:inset-0 after:content-['']">
                {voucher.title}
              </Link>
            </h3>
          </div>
          <Badge variant={statusCopy.badgeVariant} className="shrink-0">
            {statusCopy.label}
          </Badge>
        </div>
        {/* flex-wrap: at 320px x 200% zoom the price and expiry text
            together don't fit one row inside the card's shrunken width;
            wrapping the expiry onto its own line beats forcing the card
            wider than the viewport (YT-0401). */}
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-sm">
          <span className="min-w-0 font-semibold text-price">
            {formatMoney(voucher.remainingValueMinor, voucher.currency)}
          </span>
          <span className="min-w-0 text-xs text-fg-subtle">
            {statusCopy.isArchived
              ? t("voucher.expiresOn", { date: formatWalletDate(voucher.expiresAt, locale) })
              : t("voucher.validUntilCard", { date: formatWalletDate(voucher.expiresAt, locale) })}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
