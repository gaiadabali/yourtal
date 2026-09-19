import { Skeleton } from "@yourtal/ui/skeleton";
import { Card, CardContent } from "@yourtal/ui/card";
import { StoreOfferFactSkeleton } from "./store-offer-fact";

/**
 * Loading placeholder for `StoreOfferCard`, used by
 * `app/(app)/store/[listingId]/loading.tsx`. Mirrors its section structure
 * — header, price, terms, four fact rows, redeem steps, balance notice,
 * primary action — using `StoreOfferFactSkeleton` so the four fact rows
 * cannot drift from the real ones (store-offer-fact.tsx).
 */
export function StoreOfferCardSkeleton() {
  return (
    <Card aria-hidden="true">
      <CardContent className="flex flex-col gap-6 p-6">
        <header className="flex flex-col gap-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="h-10 w-full" />
        </header>

        <Skeleton className="h-14 w-full rounded-md" />
        <Skeleton className="h-24 w-full rounded-md" />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_unused, index) => (
            // Static placeholder list with no reordering or identity — index is a stable, appropriate key here.
            <StoreOfferFactSkeleton key={index} />
          ))}
        </div>

        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-11 w-full rounded-md" />
        <Skeleton className="h-11 w-full rounded-md" />
      </CardContent>
    </Card>
  );
}
