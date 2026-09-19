import { Skeleton } from "@yourtal/ui/skeleton";

// Dimensions mirror the resolved layout exactly (aspect-video player,
// accrual bar, five equal chapter slots, one controls row) so nothing
// shifts when the real content lands — docs/08-web-app-and-performance.md
// §3.1's CLS budget.
export default function WatchLoading() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
      </div>
      <Skeleton className="aspect-video w-full rounded-lg" />
      <Skeleton className="h-10 w-full rounded-md" />
      <Skeleton className="h-5 w-full rounded-full" />
      <div className="flex gap-1.5">
        {Array.from({ length: 5 }, (_unused, index) => (
          <Skeleton key={index} className="h-10 flex-1 rounded-md" />
        ))}
      </div>
      <Skeleton className="h-10 w-full rounded-md" />
    </main>
  );
}
