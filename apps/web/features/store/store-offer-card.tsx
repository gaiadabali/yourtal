import type { Balance } from "@yourtal/contracts/balance";
import type { Listing } from "@yourtal/contracts/listing";
import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import { Card, CardContent } from "@yourtal/ui/card";
import { computeBalanceShortfall } from "./store-balance";
import { StoreBalanceNotice } from "./store-balance-notice";
import { categoryLabel } from "./store-category";
import { formatExpiryDate, formatListingPrice, formatStockRemaining } from "./store-format";
import { listingDistricts } from "./listing-locations";
import { StoreOfferFact } from "./store-offer-fact";
import { StoreOfferRedeemSteps } from "./store-offer-redeem-steps";
import { StoreOfferTerms } from "./store-offer-terms";
import { listingStatusPresentation } from "./store-status";

export interface StoreOfferCardProps {
  listing: Listing;
  balance: Balance;
}

/**
 * The offer detail page (YT-0421) — "the store's honesty claim", the same
 * role `CampaignEntryCard` plays for the earn loop. Document order is load
 * bearing here: header and price come first, then the terms block
 * (`StoreOfferTerms`) — every acceptance-criteria term, above the fold,
 * before any other section — then supporting facts, how-to-redeem, the
 * balance notice, and only then the single primary action. Nothing here is
 * behind a collapsed accordion, so scrolling straight down the page reads
 * the terms before ever reaching a button.
 */
export function StoreOfferCard({ listing, balance }: StoreOfferCardProps) {
  const status = listingStatusPresentation(listing.status);
  const { pointsLabel, faceValueLabel } = formatListingPrice(
    listing.priceInPoints,
    listing.faceValueIdr,
  );
  const isSoldOut = listing.status === "sold_out" || listing.stockRemaining === 0;
  const shortfall = computeBalanceShortfall(listing.priceInPoints, balance.availablePoints);
  const canRedeem = !isSoldOut && shortfall.isAffordable;
  // Plain string, not a typed `Route`: /store/[listingId]/redeem is another
  // in-flight ticket's route (YT-0422) and may not exist on disk yet. It is
  // only ever used on a plain `<a>` below (see the same reasoning on that
  // element), so it never needs to satisfy `next/link`'s `Route` union.
  const redeemHref = `/store/${listing.id}/redeem`;

  return (
    <Card>
      <CardContent className="flex flex-col gap-6 p-6">
        <header className="flex flex-col gap-1">
          <p className="text-xs text-fg-subtle">{listing.merchantName}</p>
          <div className="flex items-start justify-between gap-2">
            <h1 className="text-xl font-semibold text-fg">{listing.title}</h1>
            {status ? <Badge variant={status.badgeVariant}>{status.label}</Badge> : null}
          </div>
          <p className="text-sm text-fg-muted">{listing.description}</p>
        </header>

        <div className="flex items-baseline gap-2 rounded-md bg-surface px-3 py-3">
          <span className="text-2xl font-semibold text-price">{pointsLabel}</span>
          <span className="text-sm text-fg-muted">{faceValueLabel}</span>
        </div>

        <StoreOfferTerms
          partialRedemptionPolicy={listing.partialRedemptionPolicy}
          minimumSpendIdr={listing.minimumSpendIdr}
          transferable={listing.transferable}
        />

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <StoreOfferFact label="Kategori" value={categoryLabel(listing.category)} />
          <StoreOfferFact label="Lokasi" value={listingDistricts(listing).join(", ")} />
          <StoreOfferFact label="Stok" value={formatStockRemaining(listing.stockRemaining)} />
          <StoreOfferFact label="Berlaku hingga" value={formatExpiryDate(listing.expiresAt)} />
        </dl>

        <StoreOfferRedeemSteps
          merchantName={listing.merchantName}
          districts={listingDistricts(listing)}
        />

        <StoreBalanceNotice
          priceInPoints={listing.priceInPoints}
          availablePoints={balance.availablePoints}
        />

        {canRedeem ? (
          <Button asChild size="lg">
            {/* Plain anchor, not next/link: /store/[listingId]/redeem is another
                in-flight ticket's route (YT-0422) and may not exist on disk
                yet, mirroring campaign-entry-card.tsx's own reasoning for
                its watch link. */}
            <a href={redeemHref}>Tukar Sekarang</a>
          </Button>
        ) : (
          <Button size="lg" disabled>
            {isSoldOut ? "Stok habis" : "Poin belum cukup"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
