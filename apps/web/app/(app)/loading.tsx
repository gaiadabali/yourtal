import { Skeleton } from "@yourtal/ui/skeleton";

/**
 * Shared fallback for every segment in the (app) group that does not ship
 * its own `loading.tsx`. It must stay TAB-AGNOSTIC: `page.tsx` (Earn) and
 * `layout.tsx` live in this same directory, so a route-specific skeleton
 * here leaks into sibling routes — an earlier version rendered an "Earn"
 * heading for any segment that suspended. The Earn board's own skeleton
 * lives in an in-page <Suspense> boundary instead.
 *
 * Fixed heights, not intrinsic ones, so the swap to real content does not
 * move the page (CLS <= 0.1 CI gate).
 */
export default function AppSegmentLoading() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-10 w-full sm:w-96" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
