import { Skeleton } from "@yourtal/ui/skeleton";

/**
 * Loading state for the business console (YT-0440). Scoped to `business/`,
 * not the shared `(app)/loading.tsx` — mirrors `store/loading.tsx`'s
 * reasoning. Shape roughly matches `ConsoleShell` + `ConsoleZoneGrid` so
 * there is no layout shift once real content swaps in.
 */
export default function BusinessConsoleLoading() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 border-b border-border-strong pb-4">
        <Skeleton className="h-8 w-48" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );
}
