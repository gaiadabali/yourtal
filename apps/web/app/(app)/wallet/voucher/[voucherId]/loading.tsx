import { Skeleton } from "@yourtal/ui/skeleton";
import { PageContainer } from "@yourtal/ui/page-container";

/** Loading state for the voucher detail screen (6.5.b), layout-stable per docs/13b-typescript-standards.md §8. */
export default function WalletVoucherDetailLoading() {
  return (
    <PageContainer width="narrow" className="flex flex-col gap-4 py-4">
      <Skeleton className="h-96 w-full rounded-card" />
      <Skeleton className="h-24 w-full rounded-card" />
    </PageContainer>
  );
}
