import { Skeleton } from "@yourtal/ui/skeleton";

/**
 * Suspense fallback for `/merchant` (docs/13b-typescript-standards.md §8:
 * "every async subtree gets an explicit loading.tsx"). Fixed heights so
 * the swap to real content does not shift the layout (CLS <= 0.1 gate) —
 * same discipline as `apps/web/app/(app)/loading.tsx`.
 */
export default function MerchantLoading() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
