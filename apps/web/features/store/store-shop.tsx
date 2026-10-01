import { X } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { listingCategorySchema } from "@yourtal/contracts/listing";
import { cn } from "@yourtal/ui/cn";
import type { StoreBrowseData } from "./store-browse-data";
import { StoreFilters } from "./store-filters";
import { getStoreTranslator, type SupportedLocale } from "./store-i18n";
import {
  EMPTY_STORE_QUERY,
  activeFilterCount,
  storeHref,
  withFilters,
  type StoreQuery,
} from "./store-query";
import { StoreToolbar } from "./store-toolbar";
import { StoreVoucherCard } from "./store-voucher-card";

export interface StoreShopProps {
  data: StoreBrowseData;
  query: StoreQuery;
  locale: SupportedLocale;
  /** `/store`, or a brand page's own path. */
  base: string;
  /** Set on a brand page: no brand filter, and the heading is the brand. */
  brand?: { name: string };
}

const CHIP =
  "inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-control px-3 text-label font-sans font-semibold " +
  "transition-colors duration-(--duration-fast) ease-standard focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/**
 * 13.15: the store as a shop. Search and sort on top, category chips, the
 * filters in a sidebar (a sheet below lg), removable active filters, a count
 * and paging. Filtering runs on the server; see `store-browse-data.ts`.
 */
export async function StoreShop({ data, query, locale, base, brand }: StoreShopProps) {
  const st = getStoreTranslator(locale);
  const t = await getTranslations("store.shop");
  const tx = await getTranslations("taxonomy");
  const tagLabel = (id: string) => (tx.has(`node.${id}`) ? tx(`node.${id}`) : id);
  const brandName = (id: string) => data.facets.brands.find((b) => b.value === id)?.label ?? id;
  const showBrands = brand === undefined;
  const lastId = data.listings.at(-1)?.id;

  const categories = listingCategorySchema.options;
  const active: { key: string; label: string; href: string }[] = [
    ...(query.where
      ? [
          {
            key: "where",
            label: query.where === "in_store" ? t("whereInStore") : t("whereOnline"),
            href: storeHref(withFilters(query, { where: null }), base),
          },
        ]
      : []),
    ...query.brands.map((id) => ({
      key: `brand-${id}`,
      label: brandName(id),
      href: storeHref(withFilters(query, { brands: query.brands.filter((b) => b !== id) }), base),
    })),
    ...query.tags.map((id) => ({
      key: `tag-${id}`,
      label: tagLabel(id),
      href: storeHref(withFilters(query, { tags: query.tags.filter((tag) => tag !== id) }), base),
    })),
    ...(query.minPoints !== null || query.maxPoints !== null
      ? [
          {
            key: "points",
            label: t("pointsRange", {
              min: query.minPoints ?? 0,
              max: query.maxPoints ?? "∞",
            }),
            href: storeHref(withFilters(query, { minPoints: null, maxPoints: null }), base),
          },
        ]
      : []),
    ...(query.location
      ? [
          {
            key: "location",
            label: query.location,
            href: storeHref(withFilters(query, { location: null }), base),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-5">
      <StoreToolbar
        query={query}
        facets={data.facets}
        locations={data.locations}
        total={data.total}
        base={base}
        showBrands={showBrands}
      />
      <nav aria-label={t("categories")}>
        <ul className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          {[null, ...categories].map((category) => {
            const on = query.category === category;
            return (
              <li key={category ?? "all"}>
                <a
                  href={storeHref(withFilters(query, { category }), base)}
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    CHIP,
                    on ? "bg-fg text-canvas" : "bg-surface-sunken text-fg hover:bg-border-subtle",
                  )}
                >
                  {category === null ? st("category.all") : st(`category.${category}`)}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8">
        <aside aria-label={t("filters")} className="hidden lg:block">
          <div className="sticky top-20 flex flex-col gap-4">
            <StoreFilters
              query={query}
              facets={data.facets}
              locations={data.locations}
              base={base}
              showBrands={showBrands}
            />
          </div>
        </aside>

        <section aria-labelledby="store-results" className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id="store-results"
              className="mr-2 text-body font-sans font-semibold text-fg"
              aria-live="polite"
            >
              {t("count", { count: data.total })}
            </h2>
            {active.map((chip) => (
              <a
                key={chip.key}
                href={chip.href}
                aria-label={t("remove", { name: chip.label })}
                className="inline-flex h-8 items-center gap-1 rounded-pill border border-border-control px-3 text-caption font-sans font-semibold text-fg hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-focus"
              >
                {chip.label}
                <X aria-hidden="true" className="h-3.5 w-3.5" />
              </a>
            ))}
            {activeFilterCount(query) > 1 ? (
              <a
                href={storeHref(
                  { ...EMPTY_STORE_QUERY, q: query.q, category: query.category, sort: query.sort },
                  base,
                )}
                className="text-caption font-sans font-semibold text-accent hover:underline"
              >
                {t("clearAll")}
              </a>
            ) : null}
          </div>

          {data.listings.length === 0 ? (
            <div className="flex flex-col items-start gap-3 rounded-card border border-dashed border-border-subtle p-8">
              <p className="font-display text-title font-bold text-fg">{t("noneHeading")}</p>
              <p className="text-body font-sans text-fg-muted">{t("noneBody")}</p>
              <a
                href={base}
                className="text-label font-sans font-semibold text-accent hover:underline"
              >
                {t("clearAll")}
              </a>
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
              {data.listings.map((listing, index) => (
                <li key={listing.id}>
                  <StoreVoucherCard listing={listing} locale={locale} priority={index < 2} />
                </li>
              ))}
            </ul>
          )}

          {data.hasMore || query.after ? (
            <nav aria-label={t("pages")} className="flex items-center justify-center gap-3 pt-2">
              {query.after ? (
                <a
                  href={storeHref(withFilters(query, {}), base)}
                  className="text-label font-sans font-semibold text-accent hover:underline"
                >
                  {t("firstPage")}
                </a>
              ) : null}
              {data.hasMore && lastId ? (
                <a
                  href={storeHref({ ...query, after: lastId }, base)}
                  className="inline-flex h-10 items-center rounded-control bg-surface-sunken px-4 text-label font-sans font-semibold text-fg hover:bg-border-subtle"
                >
                  {t("nextPage")}
                </a>
              ) : null}
            </nav>
          ) : null}
        </section>
      </div>
    </div>
  );
}
