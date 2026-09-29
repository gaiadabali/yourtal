import Link from "next/link";
import type { Route } from "next";
import type { PublicListing } from "@yourtal/contracts/listing";
import { Badge } from "@yourtal/ui/badge";
import { StoreListingCardLayout } from "./store-listing-card-layout";
import { categoryLabel } from "./store-category";
import { formatListingPrice } from "./store-format";
import { listingDistrictLabel } from "./listing-locations";
import { listingStatusPresentation } from "./store-status";
import type { SupportedLocale } from "./store-i18n";

export interface StoreListingCardProps {
  listing: PublicListing;
  /** YT-0405: required, not defaulted — see `campaign-card.tsx`'s report. */
  locale: SupportedLocale;
}

/**
 * One card on the Store browse grid (YT-0420). Acceptance criteria this
 * satisfies: price in points shown with the live face value beside it, and
 * a sold-out/expiring/newly-added badge (store-status.ts) when the listing
 * is in one of those three states.
 *
 * Only the title is a real link; a `::after` stretched-link pseudo-element
 * extends the click target to the whole card, matching `campaign-card.tsx`.
 */
export function StoreListingCard({ listing, locale }: StoreListingCardProps) {
  const href = `/store/${listing.id}` as Route;
  const status = listingStatusPresentation(listing.status, locale);
  const { pointsLabel, faceValueLabel } = formatListingPrice(
    listing.priceInPoints,
    listing.faceValueMinor,
    locale,
    // The listing's own currency (YT-0513), never the viewer's region.
    listing.currency,
  );

  return (
    <StoreListingCardLayout
      className="relative"
      imageSlot={
        <img src={listing.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
      }
      merchantSlot={
        <p className="truncate text-xs text-fg-subtle" title={listing.merchantName}>
          {listing.merchantName}
        </p>
      }
      titleSlot={
        // h2, not h3: the page's own <h1> ("Store") has no h2 between it and
        // the grid, and axe's heading-order rule (correctly) flags a level
        // skipped, not just a level reused — found running 11.6.a's axe pass.
        <h2 className="line-clamp-2 text-sm font-semibold leading-5 text-fg">
          <Link href={href} className="static after:absolute after:inset-0 after:content-['']">
            {listing.title}
          </Link>
        </h2>
      }
      metaSlot={
        <div className="flex items-center gap-1.5 truncate text-xs text-fg-muted">
          <span>{categoryLabel(listing.category, locale)}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{listingDistrictLabel(listing, locale)}</span>
        </div>
      }
      footerSlot={
        <>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold text-price">{pointsLabel}</span>
            <span className="truncate text-caption text-fg-subtle">{faceValueLabel}</span>
          </span>
          {status ? (
            <Badge variant={status.badgeVariant} className="shrink-0">
              {status.label}
            </Badge>
          ) : null}
        </>
      }
    />
  );
}
