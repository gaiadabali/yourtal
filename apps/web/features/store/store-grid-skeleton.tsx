import { StoreListingCardSkeleton } from "./store-listing-card-skeleton";

export interface StoreGridSkeletonProps {
  /** How many placeholder cards to show. Defaults to a full first screen at the densest breakpoint. */
  count?: number;
}

/** Loading placeholder for `StoreGrid`, used by `app/(app)/store/loading.tsx`. */
export function StoreGridSkeleton({ count = 10 }: StoreGridSkeletonProps) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" aria-hidden="true">
      {Array.from({ length: count }, (_unused, index) => (
        // Static placeholder list with no reordering or identity — index is a stable, appropriate key here.
        <li key={index}>
          <StoreListingCardSkeleton />
        </li>
      ))}
    </ul>
  );
}
