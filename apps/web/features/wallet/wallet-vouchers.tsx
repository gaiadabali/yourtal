import { getTranslations } from "next-intl/server";
import { MapPin, QrCode } from "lucide-react";
import { StatusBadge } from "@yourtal/ui/status-badge";
import { cn } from "@yourtal/ui/cn";
import type { WalletVoucherDetail } from "./wallet-data";
import { formatWalletDate, type SupportedLocale } from "./wallet-format";
import { describeVoucherStatus, isVoucherEffectivelyExpired } from "./wallet-voucher-status-copy";

export type VoucherTab = "active" | "past";

export interface WalletVouchersProps {
  vouchers: readonly WalletVoucherDetail[];
  tab: VoucherTab;
  /** Builds the wallet URL for a tab, keeping the other params. */
  tabHref: (tab: VoucherTab) => string;
  nowMs: number;
  locale: SupportedLocale;
}

/**
 * 13.19.b: active vouchers first, each one tap from its QR, with the expiry
 * and where to use it. Used and expired vouchers sit in their own tab.
 */
export async function WalletVouchers({
  vouchers,
  tab,
  tabHref,
  nowMs,
  locale,
}: WalletVouchersProps) {
  const t = await getTranslations("wallet");
  const described = vouchers.map((voucher) => ({
    voucher,
    status: describeVoucherStatus(
      voucher.state,
      isVoucherEffectivelyExpired(voucher.expiresAt, nowMs),
      t,
      voucher.status,
    ),
  }));
  const active = described.filter((row) => !row.status.isArchived);
  const past = described.filter((row) => row.status.isArchived);
  const shown = tab === "active" ? active : past;

  return (
    <section aria-labelledby="wallet-vouchers" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="wallet-vouchers" className="font-display text-headline font-bold text-fg">
          {t("overview.vouchers")}
        </h2>
        <nav
          aria-label={t("overview.vouchers")}
          className="flex gap-1 rounded-control bg-surface-sunken p-1"
        >
          {(["active", "past"] as const).map((value) => (
            <a
              key={value}
              href={tabHref(value)}
              aria-current={tab === value ? "page" : undefined}
              className={cn(
                "rounded-control px-3 py-1.5 text-label font-sans font-semibold",
                tab === value ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
              )}
            >
              {value === "active"
                ? t("overview.tabActive", { count: active.length })
                : t("overview.tabPast", { count: past.length })}
            </a>
          ))}
        </nav>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-card border border-dashed border-border-subtle p-6 text-body-sm font-sans text-fg-muted">
          {tab === "active" ? t("overview.noActive") : t("overview.noPast")}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map(({ voucher, status }) => {
            const href = `/wallet/voucher/${voucher.voucherId}`;
            return (
              <li
                key={voucher.voucherId}
                className="relative flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    {voucher.merchantName ? (
                      <p className="truncate text-caption font-sans font-semibold uppercase tracking-wide text-fg-muted">
                        {voucher.merchantName}
                      </p>
                    ) : null}
                    <h3 className="line-clamp-2 text-body font-sans font-semibold text-fg">
                      <a
                        href={href}
                        className="after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-focus"
                      >
                        {voucher.title ?? t("voucher.genericTitle")}
                      </a>
                    </h3>
                  </div>
                  <StatusBadge status={status.badgeStatus} emphasis="subtle" className="shrink-0">
                    {status.label}
                  </StatusBadge>
                </div>
                <div className="flex flex-col gap-1 text-body-sm font-sans text-fg-muted">
                  {voucher.expiresAt ? (
                    <span>
                      {status.isArchived
                        ? t("voucher.expiresOn", {
                            date: formatWalletDate(voucher.expiresAt, locale),
                          })
                        : t("voucher.validUntilCard", {
                            date: formatWalletDate(voucher.expiresAt, locale),
                          })}
                    </span>
                  ) : null}
                  {voucher.location ? (
                    <span className="flex items-center gap-1.5">
                      <MapPin aria-hidden="true" className="h-4 w-4 shrink-0" />
                      <span className="truncate">
                        {voucher.location.name.includes(voucher.location.district)
                          ? voucher.location.name
                          : `${voucher.location.name} · ${voucher.location.district}`}
                      </span>
                    </span>
                  ) : null}
                </div>
                {status.isArchived ? null : (
                  <span
                    aria-hidden="true"
                    className="mt-auto inline-flex h-10 items-center justify-center gap-2 rounded-control bg-accent text-label font-sans font-bold text-fg-on-accent"
                  >
                    <QrCode className="h-4 w-4" />
                    {t("overview.showQr")}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
