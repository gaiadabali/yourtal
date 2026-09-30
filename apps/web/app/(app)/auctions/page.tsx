import { getTranslations } from "next-intl/server";
import { listingCategorySchema } from "@yourtal/contracts/listing";
import { EmptyState } from "@yourtal/ui/empty-state";
import { ErrorState } from "@yourtal/ui/error-state";
import { cn } from "@yourtal/ui/cn";
import { AuctionCard } from "@/features/auction/auction-card";
import { AuctionPageShell } from "@/features/auction/auction-page-shell";
import { auctionSource } from "@/features/auction/auction-source";
import { getStoreTranslator } from "@/features/store/store-i18n";
import { getDisplayLocale } from "@/i18n/get-locale";

const CHIP =
  "inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-control px-3 text-label font-sans font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** 13.22.d: open charity auctions in the viewer's region, by charity and category. */
export default async function AuctionsPage(props: PageProps<"/auctions">) {
  const params = await props.searchParams;
  const category = listingCategorySchema.safeParse(first(params["category"]));
  const charityParam = first(params["charity"]);
  const [t, locale, charities] = await Promise.all([
    getTranslations("auction"),
    getDisplayLocale(),
    auctionSource.charities(),
  ]);
  const charityId = charities?.some((c) => c.id === charityParam) ? (charityParam ?? null) : null;
  const filter = { charityId, category: category.success ? category.data : null };
  const auctions = await auctionSource.list(filter);
  const st = getStoreTranslator(locale);
  const nowMs = Date.now();
  const href = (change: Partial<typeof filter>) => {
    const next = { ...filter, ...change };
    const qs = new URLSearchParams();
    if (next.charityId) qs.set("charity", next.charityId);
    if (next.category) qs.set("category", next.category);
    return qs.toString() ? `/auctions?${qs.toString()}` : "/auctions";
  };

  return (
    <AuctionPageShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex max-w-2xl flex-col gap-1">
          <h1 className="font-display text-headline font-bold text-fg">{t("title")}</h1>
          <p className="text-body font-sans text-fg-muted">{t("intro")}</p>
        </div>
        <div className="flex gap-4">
          <a
            href="/charities"
            className="text-label font-sans font-semibold text-accent hover:underline"
          >
            {t("charitiesLink")}
          </a>
          <a
            href="/auctions/mine"
            className="text-label font-sans font-semibold text-accent hover:underline"
          >
            {t("mine.link")}
          </a>
        </div>
      </div>

      <nav aria-label={t("categories")}>
        <ul className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          {[null, ...listingCategorySchema.options].map((value) => (
            <li key={value ?? "all"}>
              <a
                href={href({ category: value })}
                aria-current={filter.category === value ? "page" : undefined}
                className={cn(
                  CHIP,
                  filter.category === value
                    ? "bg-fg text-canvas"
                    : "bg-surface-sunken text-fg hover:bg-border-subtle",
                )}
              >
                {value === null ? st("category.all") : st(`category.${value}`)}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {charities && charities.length > 0 ? (
        <nav aria-label={t("charities")} className="flex flex-wrap gap-2">
          {[null, ...charities].map((c) => (
            <a
              key={c?.id ?? "any"}
              href={href({ charityId: c?.id ?? null })}
              aria-current={filter.charityId === (c?.id ?? null) ? "page" : undefined}
              className={cn(
                "inline-flex h-8 items-center rounded-pill border px-3 text-caption font-sans font-semibold",
                filter.charityId === (c?.id ?? null)
                  ? "border-success-solid bg-success-subtle text-success-on-subtle"
                  : "border-border-control text-fg hover:bg-surface-sunken",
              )}
            >
              {c?.name ?? t("anyCharity")}
            </a>
          ))}
        </nav>
      ) : null}

      {auctions === null ? (
        <ErrorState title={t("error.title")} description={t("error.body")} />
      ) : auctions.length === 0 ? (
        <EmptyState title={t("empty.title")} description={t("empty.body")} />
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
