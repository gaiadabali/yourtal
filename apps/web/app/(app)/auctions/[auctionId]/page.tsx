import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { HeartHandshake } from "lucide-react";
import { formatMoney } from "@yourtal/contracts/money/format";
import { MoneyAmount } from "@yourtal/ui/money-amount";
import { Notice } from "@yourtal/ui/notice";
import { AuctionBidForm } from "@/features/auction/auction-bid-form";
import { AuctionPageShell } from "@/features/auction/auction-page-shell";
import { auctionSource } from "@/features/auction/auction-source";
import { timeLeftParts } from "@/features/auction/auction-time";
import { formatWalletDate } from "@/features/wallet/wallet-format";
import { getDisplayLocale } from "@/i18n/get-locale";

/** 13.22.d: one auction. Only the amount and bid count are public; your own standing is yours. */
export default async function AuctionPage(props: PageProps<"/auctions/[auctionId]">) {
  const { auctionId } = await props.params;
  const [auction, t, locale] = await Promise.all([
    auctionSource.get(auctionId),
    getTranslations("auction"),
    getDisplayLocale(),
  ]);
  if (!auction) notFound();
  const nowMs = Date.now();
  const left = timeLeftParts(auction.endsAt, nowMs);
  const open = auction.state === "open";
  const { viewer } = auction;
  const money = (minor: number) => (
    <MoneyAmount amountMinor={minor} currency={auction.currency} locale={locale} />
  );

  return (
    <AuctionPageShell>
      <a
        href="/auctions"
        className="w-fit text-label font-sans font-semibold text-accent hover:underline"
      >
        {t("back")}
      </a>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="flex flex-col gap-4">
          <p className="text-caption font-sans font-semibold uppercase tracking-wide text-fg-muted">
            {auction.voucher.merchantName}
          </p>
          <h1 className="font-display text-headline font-bold text-fg">{auction.voucher.title}</h1>
          <p className="text-body font-sans text-fg-muted">
            {t("voucherFacts", {
              date: formatWalletDate(auction.voucher.expiresAt, locale),
            })}{" "}
            {t("worth")} {money(auction.voucher.faceValueMinor)}
          </p>
          <div className="flex items-start gap-3 rounded-card border border-success-solid/30 bg-success-subtle p-4">
            <HeartHandshake
              aria-hidden="true"
              className="mt-0.5 h-5 w-5 shrink-0 text-success-on-subtle"
            />
            <div className="flex flex-col gap-1">
              <p className="text-body font-sans font-semibold text-success-on-subtle">
                {t("forCharity", { name: auction.charity.name })}
              </p>
              <p className="text-body-sm font-sans text-fg-muted">{t("moneyPath")}</p>
            </div>
          </div>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-body-sm font-sans text-fg-muted">
            <li>{t("rules.reserve")}</li>
            <li>{t("rules.extension")}</li>
            <li>{t("rules.private")}</li>
            <li>{t("rules.hold")}</li>
          </ul>
        </section>

        <aside className="flex flex-col gap-4 rounded-sheet border border-border-subtle bg-surface p-5 lg:sticky lg:top-20 lg:self-start">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-label font-sans font-semibold text-fg-muted">
              {auction.currentAmountMinor === null ? t("startsAt") : t("currentBid")}
            </span>
            <span className="text-caption font-sans text-fg-subtle">
              {t("bidCount", { count: auction.bidCount })}
            </span>
          </div>
          <p className="font-display text-display font-extrabold tabular-nums text-fg">
            {money(auction.currentAmountMinor ?? auction.reserveMinor)}
          </p>
          <p className="text-body-sm font-sans font-semibold text-fg-muted">
            {open
              ? t(`left.${left.key}`, left.values)
              : t(`outcome.${auction.outcome ?? "unsold"}`)}
          </p>
          {viewer.yourHighestBidMinor !== null ? (
            <Notice
              tone={
                viewer.bidStatus === "leading" || viewer.bidStatus === "won" ? "success" : "warning"
              }
            >
              {t(`yourStanding.${viewer.bidStatus}`, {
                amount: formatMoney(viewer.yourHighestBidMinor, auction.currency),
              })}
            </Notice>
          ) : null}
          {viewer.role === "seller" ? (
            <Notice tone="info">{t("yourListing")}</Notice>
          ) : open ? (
            <AuctionBidForm
              auctionId={auction.auctionId}
              currency={auction.currency}
              minimumNextBidMinor={auction.minimumNextBidMinor}
              minimumLabel={formatMoney(auction.minimumNextBidMinor, auction.currency)}
            />
          ) : null}
        </aside>
      </div>
    </AuctionPageShell>
  );
}
