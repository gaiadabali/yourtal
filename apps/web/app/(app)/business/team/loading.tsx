import { Skeleton } from "@yourtal/ui/skeleton";

/** Loading state for the Team zone (YT-0444), scoped to `business/team/` — mirrors `store/loading.tsx`'s reasoning. */
export default function BusinessTeamLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-7 w-16" />
        <Skeleton className="h-10 w-36" />
      </div>
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
