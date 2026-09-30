import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BadgeCheck } from "lucide-react";
import { EmptyState } from "@yourtal/ui/empty-state";
import { ErrorState } from "@yourtal/ui/error-state";
import { AuctionCard } from "@/features/auction/auction-card";
import { AuctionPageShell } from "@/features/auction/auction-page-shell";
import { auctionSource } from "@/features/auction/auction-source";
import { CharityLogo } from "@/features/charity/charity-logo";
import { getCharity } from "@/features/charity/charity-data";
import { getDisplayLocale } from "@/i18n/get-locale";

/** 13.21.b: one charity, and the auctions open for it now. */
export default async function CharityPage(props: PageProps<"/charities/[charityId]">) {
  const { charityId } = await props.params;
  const [t, locale, charity, auctions] = await Promise.all([
    getTranslations("charity"),
    getDisplayLocale(),
    getCharity(charityId),
    auctionSource.list({ charityId, category: null }),
  ]);
  if (charity === "missing") notFound();
  const nowMs = Date.now();
  return (
    <AuctionPageShell>
      <a
        href="/charities"
        className="w-fit text-label font-sans font-semibold text-accent hover:underline"
      >
        {t("browse.back")}
      </a>
      {charity === null ? (
        <ErrorState title={t("browse.error.title")} description={t("browse.error.body")} />
      ) : (
        <>
          <header className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <CharityLogo charity={charity} />
            <div className="flex flex-col gap-1">
              <h1 className="font-display text-headline font-bold text-fg">{charity.name}</h1>
              <p className="flex flex-wrap items-center gap-x-2 text-body-sm font-sans text-fg-muted">
                <span className="inline-flex items-center gap-1 font-semibold text-success-on-subtle">
                  <BadgeCheck aria-hidden="true" className="h-4 w-4" />
                  {t(`browse.verified.${charity.region}`)}
                </span>
                <span aria-hidden="true">·</span>
                <span>{t(`cause.${charity.cause}`)}</span>
                <span aria-hidden="true">·</span>
                <span>{t(`browse.region.${charity.region}`)}</span>
              </p>
            </div>
          </header>
          <p className="max-w-2xl text-body font-sans text-fg">{charity.summary}</p>
          <section aria-labelledby="charity-auctions" className="flex flex-col gap-4">
            <h2 id="charity-auctions" className="font-display text-title font-bold text-fg">
              {t("browse.auctionsHeading")}
            </h2>
            {auctions === null ? (
              <ErrorState title={t("browse.error.title")} description={t("browse.error.body")} />
            ) : auctions.length === 0 ? (
              <EmptyState
                title={t("browse.noAuctions.title")}
                description={t("browse.noAuctions.body")}
              />
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {auctions.map((auction) => (
                  <li key={auction.auctionId}>
                    <AuctionCard auction={auction} locale={locale} nowMs={nowMs} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </AuctionPageShell>
  );
}
