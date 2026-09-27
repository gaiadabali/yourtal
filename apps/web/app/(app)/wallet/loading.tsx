import { Skeleton } from "@yourtal/ui/skeleton";
import { PageContainer } from "@yourtal/ui/page-container";

/** Loading state for `/wallet` (6.5.a), layout-stable to keep CLS low per docs/13b-typescript-standards.md §8. */
export default function WalletLoading() {
  return (
    <PageContainer width="narrow" className="flex flex-col gap-6 py-6">
      <Skeleton className="h-8 w-24" />
      <Skeleton className="h-32 w-full rounded-card" />
      <Skeleton className="h-48 w-full rounded-card" />
    </PageContainer>
  );
}
