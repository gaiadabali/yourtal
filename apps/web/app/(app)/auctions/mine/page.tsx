import { getTranslations } from "next-intl/server";
import { EmptyState } from "@yourtal/ui/empty-state";
import { ErrorState } from "@yourtal/ui/error-state";
import { cn } from "@yourtal/ui/cn";
import { AuctionCard } from "@/features/auction/auction-card";
import { AuctionPageShell } from "@/features/auction/auction-page-shell";
import { auctionSource } from "@/features/auction/auction-source";
import { getDisplayLocale } from "@/i18n/get-locale";

/** 13.22.d: My bids and My listings, one tab each, kept in the URL. */
export default async function MyAuctionsPage(props: PageProps<"/auctions/mine">) {
  const params = await props.searchParams;
  const tab = params["tab"] === "listings" ? "listings" : "bids";
  const [t, locale, auctions] = await Promise.all([
    getTranslations("auction"),
    getDisplayLocale(),
    tab === "bids" ? auctionSource.myBids() : auctionSource.myListings(),
  ]);
  const nowMs = Date.now();
  return (
    <AuctionPageShell>
      <a
        href="/auctions"
        className="w-fit text-label font-sans font-semibold text-accent hover:underline"
      >
        {t("back")}
      </a>
      <h1 className="font-display text-headline font-bold text-fg">{t("mine.title")}</h1>
      <nav
        aria-label={t("mine.title")}
        className="flex w-fit gap-1 rounded-control bg-surface-sunken p-1"
      >
        {(["bids", "listings"] as const).map((value) => (
          <a
            key={value}
            href={value === "bids" ? "/auctions/mine" : "/auctions/mine?tab=listings"}
            aria-current={tab === value ? "page" : undefined}
            className={cn(
              "rounded-control px-3 py-1.5 text-label font-sans font-semibold",
              tab === value ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
            )}
          >
            {t(`mine.${value}`)}
          </a>
        ))}
      </nav>
      {auctions === null ? (
        <ErrorState title={t("error.title")} description={t("error.body")} />
      ) : auctions.length === 0 ? (
        <EmptyState title={t(`mine.empty.${tab}`)} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {auctions.map((auction) => (
            <li key={auction.auctionId}>
              <AuctionCard auction={auction} locale={locale} nowMs={nowMs} />
            </li>
          ))}
        </ul>
      )}
    </AuctionPageShell>
  );
}
