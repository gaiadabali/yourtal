import type { Voucher } from "@yourtal/contracts/voucher";
import { WalletVoucherCard } from "./wallet-voucher-card";
import { isVoucherEffectivelyExpired } from "./wallet-voucher-status-copy";
import { getWalletTranslator, type SupportedLocale } from "./wallet-i18n";

export interface WalletVoucherListProps {
  vouchers: Voucher[];
  nowMs: number;
  /** YT-0405: required, not defaulted — see `store-balance-notice.tsx`'s report for why. */
  locale: SupportedLocale;
}

function isActiveAndLive(voucher: Voucher, nowMs: number): boolean {
  return voucher.status === "active" && !isVoucherEffectivelyExpired(voucher, nowMs);
}

/**
 * Splits vouchers into an active section and an archived one. Archived
 * vouchers (used, expired or transferred) are never hidden or deleted —
 * YT-0424's "used and expired vouchers archived and still viewable" — they
 * render in their own, visually distinct section below the active ones,
 * always present when there is anything to show there.
 */
export function WalletVoucherList({ vouchers, nowMs, locale }: WalletVoucherListProps) {
  const t = getWalletTranslator(locale);
  const active = vouchers.filter((voucher) => isActiveAndLive(voucher, nowMs));
  const archived = vouchers.filter((voucher) => !isActiveAndLive(voucher, nowMs));

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-fg">{t("voucherList.activeHeading")}</h2>
        {active.length === 0 ? (
          <p className="text-sm text-fg-muted">{t("voucherList.activeEmpty")}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {active.map((voucher) => (
              <WalletVoucherCard key={voucher.id} voucher={voucher} nowMs={nowMs} locale={locale} />
            ))}
          </div>
        )}
      </section>
      {archived.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-fg-muted">
            {t("voucherList.archivedHeading")}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {archived.map((voucher) => (
              <WalletVoucherCard key={voucher.id} voucher={voucher} nowMs={nowMs} locale={locale} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
