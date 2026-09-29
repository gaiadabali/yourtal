import { Skeleton } from "@yourtal/ui/skeleton";

export default function ChannelLoading() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <Skeleton className="h-32 w-full rounded-lg sm:h-48" />
      <div className="flex items-center gap-3">
        <Skeleton className="size-14 rounded-full" />
        <div className="flex flex-col gap-1">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_unused, index) => (
          <Skeleton key={index} className="h-20 w-full rounded-md" />
        ))}
      </div>
    </main>
  );
}
