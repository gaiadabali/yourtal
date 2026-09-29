import { MediaCard } from "@yourtal/ui/media-card";
import type { PublicListing } from "@yourtal/contracts/listing";
import { asDisplayPoints, formatPointsIn } from "@yourtal/contracts/money/format";
import type { DisplayLocale } from "@yourtal/contracts/identity/user-profile";

export interface SearchListingCardProps {
  listing: PublicListing;
  locale: DisplayLocale;
}

/** One store listing result (11.7.b), linking to its existing offer page (`/store/[listingId]`, 11.6.b, Area C's). */
export function SearchListingCard({ listing, locale }: SearchListingCardProps) {
  return (
    <MediaCard
      href={`/store/${listing.id}`}
      poster={listing.imageUrl}
      posterAlt=""
      aspect="16:9"
      title={listing.title}
      channel={<span className="text-caption font-sans">{listing.merchantName}</span>}
      reward={
        <span className="text-caption font-sans">
          {formatPointsIn(locale, asDisplayPoints(listing.priceInPoints))}
        </span>
      }
    />
  );
}
