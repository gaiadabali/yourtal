import type { PublicListing } from "@yourtal/contracts/listing";
import { formatMoney, formatPointsIn } from "@yourtal/contracts/money/format";
import { Card, CardContent } from "@yourtal/ui/card";
import { getPlayerTranslator, type SupportedLocale } from "./player-i18n";

export interface SpendAtBrandProps {
  merchantName: string;
  listings: readonly PublicListing[];
  locale: SupportedLocale;
}

/**
 * 11.5.c: the completion screen's "Spend at <brand>" (docs/23 section
 * 1.0b) — the funder's OWN store listings, so a viewer who just earned
 * points from this campaign sees somewhere real to put them, at the same
 * business. Reuses `PublicListing` and the shared money formatters
 * directly rather than `features/store`'s own card component (Area G's
 * file, out of bounds for this ticket) — a plain link into
 * `/store/{listingId}`, the same route `store-offer-card.tsx` links to.
 */
export function SpendAtBrand({ merchantName, listings, locale }: SpendAtBrandProps) {
  const t = getPlayerTranslator(locale);
  if (listings.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-sans font-semibold text-fg">
        {t("vouchers.heading", { name: merchantName })}
      </h2>
      <ul className="flex list-none flex-col gap-2 p-0">
        {listings.map((listing) => (
          <li key={listing.id}>
            <a href={`/store/${listing.id}`} className="block">
              <Card>
                <CardContent className="flex items-center justify-between gap-3 p-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-sans font-medium text-fg">
                      {listing.title}
                    </span>
                    <span className="text-xs font-sans text-fg-muted">
                      {formatMoney(listing.faceValueMinor, listing.currency)}
                    </span>
                  </div>
                  <span className="shrink-0 text-sm font-sans font-semibold text-price">
                    {formatPointsIn(locale, listing.priceInPoints)}
                  </span>
                </CardContent>
              </Card>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
