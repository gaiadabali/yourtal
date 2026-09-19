import { Skeleton } from "@yourtal/ui/skeleton";

/** Loading state for `/wallet` (YT-0423), layout-stable to keep CLS low per docs/13b-typescript-standards.md §8. */
export default function WalletLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4">
      <Skeleton className="h-8 w-24" />
      <Skeleton className="h-32 w-full rounded-lg" />
      <Skeleton className="h-48 w-full rounded-lg" />
    </div>
  );
}
