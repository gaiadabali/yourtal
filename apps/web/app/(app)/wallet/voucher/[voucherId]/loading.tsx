import { Skeleton } from "@yourtal/ui/skeleton";

/** Loading state for the voucher detail screen (YT-0424), layout-stable per docs/13b-typescript-standards.md §8. */
export default function WalletVoucherDetailLoading() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
      <Skeleton className="h-96 w-full rounded-lg" />
      <Skeleton className="h-24 w-full rounded-lg" />
    </div>
  );
}
