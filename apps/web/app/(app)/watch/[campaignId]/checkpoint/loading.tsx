import { Skeleton } from "@yourtal/ui/skeleton";

/** Layout-stable fallback while `page.tsx` resolves — same shape as the loaded question step, so nothing shifts (CLS gate). */
export default function CheckpointLoading() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 p-4 pb-24" aria-busy="true">
      <span className="sr-only">Memuat pertanyaan checkpoint…</span>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-2 w-full rounded-full" />
      <Skeleton className="h-8 w-24 rounded-full" />
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-40 w-full rounded-lg" />
      <Skeleton className="h-10 w-full rounded-md" />
    </main>
  );
}
