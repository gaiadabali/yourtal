import Link from "next/link";
import type { Route } from "next";
import type { Listing } from "@yourtal/contracts/listing";
import { Badge } from "@yourtal/ui/badge";
import { StoreListingCardLayout } from "./store-listing-card-layout";
import { categoryLabel } from "./store-category";
import { formatListingPrice } from "./store-format";
import { listingStatusPresentation } from "./store-status";

export interface StoreListingCardProps {
  listing: Listing;
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
export function StoreListingCard({ listing }: StoreListingCardProps) {
  const href = `/store/${listing.id}` as Route;
  const status = listingStatusPresentation(listing.status);
  const { pointsLabel, faceValueLabel } = formatListingPrice(
    listing.priceInPoints,
    listing.faceValueIdr,
  );

  return (
    <StoreListingCardLayout
      className="relative"
      merchantSlot={
        <p className="truncate text-xs text-fg-subtle" title={listing.merchantName}>
          {listing.merchantName}
        </p>
      }
      titleSlot={
        <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-fg">
          <Link href={href} className="static after:absolute after:inset-0 after:content-['']">
            {listing.title}
          </Link>
        </h3>
      }
      metaSlot={
        <div className="flex items-center gap-1.5 truncate text-xs text-fg-muted">
          <span>{categoryLabel(listing.category)}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{listing.district}</span>
        </div>
      }
      footerSlot={
        <>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold text-price">{pointsLabel}</span>
            <span className="truncate text-[11px] text-fg-subtle">{faceValueLabel}</span>
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
