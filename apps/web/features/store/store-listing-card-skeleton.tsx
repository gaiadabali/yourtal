import { Skeleton } from "@yourtal/ui/skeleton";
import { StoreListingCardLayout } from "./store-listing-card-layout";

/**
 * Loading placeholder for `StoreListingCard`. Renders through the exact
 * same `StoreListingCardLayout` frame as the real card, so there is no
 * separate set of dimension numbers to keep in sync by hand.
 */
export function StoreListingCardSkeleton() {
  return (
    <StoreListingCardLayout
      merchantSlot={<Skeleton className="h-4 w-2/5" />}
      titleSlot={<Skeleton className="h-full w-4/5" />}
      metaSlot={<Skeleton className="h-4 w-3/5" />}
      footerSlot={
        <div className="flex flex-col gap-1">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-3 w-20" />
        </div>
      }
    />
  );
}
