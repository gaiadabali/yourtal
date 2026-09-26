import { Skeleton } from "@yourtal/ui/skeleton";

/** Loading state for `/me` (TASKS.md 6.7.a), layout-stable per docs/13b section 8. */
export default function MeLoading() {
  return (
    <div className="mx-auto flex w-full max-w-page-narrow flex-col gap-6 px-gutter-sm py-6 md:px-gutter-md">
      <Skeleton className="h-8 w-24" />
      <Skeleton className="h-32 w-full rounded-lg" />
      <Skeleton className="h-48 w-full rounded-lg" />
      <Skeleton className="h-48 w-full rounded-lg" />
    </div>
  );
}
