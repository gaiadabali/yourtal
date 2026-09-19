import { Skeleton } from "@yourtal/ui/skeleton";
import { StoreGridSkeleton } from "@/features/store/store-grid-skeleton";

/**
 * Loading state for the Store browse grid (YT-0420). Scoped to this
 * segment only — it does not leak into sibling tabs the way the group-root
 * `app/(app)/loading.tsx` intentionally would (see that file's own
 * docstring), because it lives under `store/`, not the shared `(app)/`
 * group folder.
 */
export default function StoreLoading() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <Skeleton className="h-8 w-24" />
      <div className="flex flex-wrap gap-3">
        <Skeleton className="h-14 w-40" />
        <Skeleton className="h-14 w-40" />
        <Skeleton className="h-14 w-40" />
        <Skeleton className="h-14 w-40" />
      </div>
      <StoreGridSkeleton />
    </div>
  );
}
