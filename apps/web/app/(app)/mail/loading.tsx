import { PageContainer } from "@yourtal/ui/page-container";
import { Skeleton } from "@yourtal/ui/skeleton";

/** Loading state for `/mail`, the shape of the shell so the page does not jump. */
export default function MailLoading() {
  return (
    <PageContainer width="wide" className="flex flex-col gap-5 py-6">
      <Skeleton className="h-10 w-40" />
      <div className="grid gap-5 md:grid-cols-[12rem_minmax(0,1fr)]">
        <Skeleton className="h-48 w-full rounded-card" />
        <Skeleton className="h-96 w-full rounded-card" />
      </div>
    </PageContainer>
  );
}
