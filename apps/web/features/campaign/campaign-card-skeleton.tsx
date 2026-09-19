import { Skeleton } from "@yourtal/ui/skeleton";
import { CampaignCardLayout } from "./campaign-card-layout";

/**
 * The loading placeholder for `CampaignCard` (YT-0410: "skeletons match
 * final dimensions exactly so nothing shifts"). It renders through the
 * exact same `CampaignCardLayout` frame as the real card — same row
 * heights, same padding, same gap — so there is no separate set of
 * dimension numbers to keep in sync by hand.
 */
export function CampaignCardSkeleton() {
  return (
    <CampaignCardLayout
      merchantSlot={<Skeleton className="h-4 w-2/5" />}
      titleSlot={<Skeleton className="h-full w-4/5" />}
      metaSlot={<Skeleton className="h-4 w-3/5" />}
      footerSlot={<Skeleton className="h-6 w-1/3 rounded-full" />}
    />
  );
}
