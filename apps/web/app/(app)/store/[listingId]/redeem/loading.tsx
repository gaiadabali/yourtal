import { Skeleton } from "@yourtal/ui/skeleton";

/** Layout-stable fallback while `page.tsx` resolves — same shape as the loaded review step, so nothing shifts (CLS gate, docs/13b section 8). */
export default function RedeemLoading() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4 pb-24" aria-busy="true">
      <span className="sr-only">Memuat penukaran…</span>
      <div className="flex flex-col gap-1">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-40" />
      </div>
      <Skeleton className="h-12 w-full rounded-lg" />
      <Skeleton className="h-40 w-full rounded-lg" />
      <Skeleton className="h-10 w-full rounded-md" />
    </main>
  );
}
