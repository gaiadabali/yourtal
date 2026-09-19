import { CampaignCardSkeleton } from "./campaign-card-skeleton";

export interface CampaignGridSkeletonProps {
  /** How many placeholder cards to show. Defaults to a full first screen at the densest breakpoint. */
  count?: number;
}

/**
 * Loading placeholder for `CampaignGrid` (YT-0410 loading state). Same grid
 * classes as the real grid, filled with `CampaignCardSkeleton`, whose
 * dimensions are guaranteed to match `CampaignCard` via the shared
 * `CampaignCardLayout` frame — see campaign-card-layout.tsx.
 */
export function CampaignGridSkeleton({ count = 10 }: CampaignGridSkeletonProps) {
  return (
    <ul
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
      aria-hidden="true"
    >
      {Array.from({ length: count }, (_unused, index) => (
        // Static placeholder list with no reordering or identity — index is a stable, appropriate key here.
        <li key={index}>
          <CampaignCardSkeleton />
        </li>
      ))}
    </ul>
  );
}
