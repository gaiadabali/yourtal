import { Fragment } from "react";
import { getTranslations } from "next-intl/server";
import { Section } from "@yourtal/ui/section";
import { Text } from "@yourtal/ui/text";
import type { WalletVoucherDetail } from "./wallet-data";
import { WalletVoucherCard } from "./wallet-voucher-card";
import { isVoucherRedeemable } from "./wallet-voucher-status-copy";
import type { SupportedLocale } from "./wallet-format";

export interface WalletVoucherListProps {
  vouchers: WalletVoucherDetail[];
  nowMs: number;
  locale: SupportedLocale;
}

function isActiveAndLive(voucher: WalletVoucherDetail, nowMs: number): boolean {
  return isVoucherRedeemable(voucher, nowMs);
}

/** `WalletVoucherCard` is itself async (`getTranslations`) — resolved here explicitly rather than left as JSX, so this works under a plain renderer too, not only Next's RSC pipeline (see wallet-screen.tsx's doc comment for the same rule). */
async function renderCards(
  vouchers: WalletVoucherDetail[],
  nowMs: number,
  locale: SupportedLocale,
) {
  return Promise.all(
    vouchers.map(async (voucher) => (
      <Fragment key={voucher.voucherId}>
        {await WalletVoucherCard({ voucher, nowMs, locale })}
      </Fragment>
    )),
  );
}

/**
 * Splits vouchers into an active section and an archived one. Archived
 * vouchers (released, or effectively expired) are never hidden or deleted
 * — they render in their own, visually distinct section below the active
 * ones, always present when there is anything to show there.
 */
export async function WalletVoucherList({ vouchers, nowMs, locale }: WalletVoucherListProps) {
  const t = await getTranslations("wallet");
  const active = vouchers.filter((voucher) => isActiveAndLive(voucher, nowMs));
  const archived = vouchers.filter((voucher) => !isActiveAndLive(voucher, nowMs));
  const activeCards = await renderCards(active, nowMs, locale);
  const archivedCards = await renderCards(archived, nowMs, locale);

  return (
    <div className="flex flex-col gap-6">
      <Section title={t("voucherList.activeHeading")}>
        {active.length === 0 ? (
          <Text tone="muted">{t("voucherList.activeEmpty")}</Text>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{activeCards}</div>
        )}
      </Section>
      {archived.length > 0 ? (
        <Section title={t("voucherList.archivedHeading")}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{archivedCards}</div>
        </Section>
      ) : null}
    </div>
  );
}
