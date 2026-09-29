import Link from "next/link";
import type { Route } from "next";
import { getTranslations } from "next-intl/server";
import { MoneyAmount } from "@yourtal/ui/money-amount";
import { StatusBadge } from "@yourtal/ui/status-badge";
import { Text } from "@yourtal/ui/text";
import type { WalletVoucherDetail } from "./wallet-data";
import { describeVoucherStatus, isVoucherEffectivelyExpired } from "./wallet-voucher-status-copy";
import { formatWalletDate } from "./wallet-format";
import type { SupportedLocale } from "./wallet-format";

export interface WalletVoucherCardProps {
  voucher: WalletVoucherDetail;
  nowMs: number;
  locale: SupportedLocale;
}

/**
 * One voucher card in the Wallet's voucher list (6.5.b). Archived vouchers
 * (released, or effectively expired) render visually distinct — reduced
 * emphasis, a status badge — but never disappear. Every display field
 * beyond `voucherId`/`listingId`/`state` is optional (see `wallet-data.ts`'s
 * doc comment on why) and this card degrades to a generic placeholder for
 * whichever one the live API has not sent yet.
 */
export async function WalletVoucherCard({ voucher, nowMs, locale }: WalletVoucherCardProps) {
  const t = await getTranslations("wallet");
  const expired = isVoucherEffectivelyExpired(voucher.expiresAt, nowMs);
  const statusCopy = describeVoucherStatus(voucher.state, expired, t, voucher.status);
  const href = `/wallet/voucher/${voucher.voucherId}` as Route;

  return (
    <div
      // 11.6.d: `opacity-70` on `text-fg-subtle` failed WCAG AA color-contrast
      // in both themes (3.47:1 dark / 4.27:1 light, needs 4.5:1) — a
      // pre-existing bug this task's own Check surfaces on every
      // purchased-then-redeemed voucher (previously an archived card was
      // rare in a mock-only demo). `opacity-95` keeps the de-emphasised
      // look while staying above the threshold in both themes.
      className={`relative min-w-0 flex flex-col gap-2 rounded-card border border-border-subtle bg-surface p-4 ${statusCopy.isArchived ? "opacity-95" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {voucher.merchantName ? (
            <p className="truncate text-caption text-fg-subtle" title={voucher.merchantName}>
              {voucher.merchantName}
            </p>
          ) : null}
          <h3 className="truncate font-sans text-body font-semibold text-fg">
            <Link href={href} className="static after:absolute after:inset-0 after:content-['']">
              {voucher.title ?? t("voucher.genericTitle")}
            </Link>
          </h3>
        </div>
        <StatusBadge status={statusCopy.badgeStatus} emphasis="subtle" className="shrink-0">
          {statusCopy.label}
        </StatusBadge>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-body-sm">
        {voucher.remainingValueMinor !== undefined && voucher.currency ? (
          <MoneyAmount
            amountMinor={voucher.remainingValueMinor}
            currency={voucher.currency}
            locale={locale}
            className="min-w-0 font-semibold"
          />
        ) : (
          <Text tone="subtle" size="body-sm">
            {t("voucher.detailsUnavailable")}
          </Text>
        )}
        {/* A redeemed or voided voucher did not "end" on its expiry date. */}
        {voucher.expiresAt && (!statusCopy.isArchived || statusCopy.kind === "expired") ? (
          <Text tone="subtle" size="caption" className="min-w-0">
            {statusCopy.isArchived
              ? t("voucher.expiresOn", { date: formatWalletDate(voucher.expiresAt, locale) })
              : t("voucher.validUntilCard", { date: formatWalletDate(voucher.expiresAt, locale) })}
          </Text>
        ) : null}
      </div>
    </div>
  );
}
