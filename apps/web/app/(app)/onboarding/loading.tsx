import { Skeleton } from "@yourtal/ui/skeleton";

/**
 * Next's file convention: an automatic Suspense fallback while a step's own
 * `apiFetch` calls are in flight. Shaped like the step it is standing in
 * for (a heading, a progress indicator, a few card-height blocks) so
 * nothing jumps once the real content resolves.
 */
export default function OnboardingLoading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Loading">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
