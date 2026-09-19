import type { Listing } from "@yourtal/contracts/listing";
import { Card, CardContent } from "@yourtal/ui/card";
import { formatListingPrice } from "@/features/store/store-format";
import { getPublicTranslator } from "./public-i18n";
import { slugify } from "./public-slug";
import type { PublicLocale, PublicLocaleConfig } from "./public-locale";

export interface PublicCatalogueContentProps {
  listings: readonly Listing[];
  locale: PublicLocale;
  localeConfig: PublicLocaleConfig;
}

/**
 * The catalogue hub's body (YT-0431, `/[locale]/rewards`) — the internal
 * linking layer docs/11-seo-aeo-geo.md §2.3 calls for ("every offer links to
 * its merchant; every merchant lists its live offers"). One flat grid of
 * every public listing; this ticket does not build the fuller
 * category/city hub tiers docs/11 §2.3/§2.4 describe for a mature catalogue
 * — see this ticket's report for that scope call.
 */
export function PublicCatalogueContent({
  listings,
  locale,
  localeConfig,
}: PublicCatalogueContentProps) {
  const t = getPublicTranslator(localeConfig.intlLocale);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-fg">{t("catalogue.title")}</h1>
        <p className="text-sm text-fg-muted">{t("catalogue.description")}</p>
      </header>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {listings.map((listing) => {
          const merchantSlug = slugify(listing.merchantName);
          const price = formatListingPrice(
            listing.priceInPoints,
            listing.faceValueIdr,
            localeConfig.intlLocale,
            localeConfig.currency,
          );
          return (
            <li key={listing.id}>
              <Card>
                <CardContent className="flex flex-col gap-1 p-4">
                  <p className="text-xs text-fg-subtle">{listing.merchantName}</p>
                  <a
                    href={`/${locale}/rewards/${merchantSlug}/${listing.id}`}
                    className="text-sm font-medium text-fg hover:underline"
                  >
                    {listing.title}
                  </a>
                  <p className="text-xs text-fg-muted">
                    {price.pointsLabel} · {price.faceValueLabel}
                  </p>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
