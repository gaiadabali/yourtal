import { Skeleton } from "@yourtal/ui/skeleton";

/** Loading state for the Watch grid (11.7.d). Scoped to `watch/`, not `watch/[campaignId]`, which has its own. */
export default function WatchGridLoading() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <Skeleton className="h-8 w-24" />
      <ul
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        aria-hidden="true"
      >
        {Array.from({ length: 8 }, (_unused, index) => (
          // Static placeholder list with no reordering or identity — index is a stable, appropriate key here.
          <li key={index} className="flex flex-col gap-2">
            <Skeleton className="aspect-video w-full rounded-card" />
          </li>
        ))}
      </ul>
    </div>
  );
}
