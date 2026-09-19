import Link from "next/link";
import { Button } from "@yourtal/ui/button";

export interface StoreEmptyStateProps {
  /** Whether any of the four filters is narrowing the grid away from the full catalogue. */
  hasActiveFilters: boolean;
}

/**
 * Empty state for the Store browse grid (mirrors `campaign-empty-state.tsx`
 * from the earn board). Names the cause (a filter combination with no
 * matches) rather than a bare "no results", and gives one action that
 * clears every filter at once.
 */
export function StoreEmptyState({ hasActiveFilters }: StoreEmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <p className="text-base font-semibold text-fg">
        {hasActiveFilters ? "Tidak ada item yang cocok dengan filter ini" : "Belum ada item di store saat ini"}
      </p>
      <p className="max-w-sm text-sm text-fg-muted">
        {hasActiveFilters
          ? "Coba ubah atau hapus salah satu filter untuk melihat lebih banyak pilihan."
          : "Katalog ini diperbarui secara berkala — coba kembali lagi sebentar lagi."}
      </p>
      {hasActiveFilters ? (
        <Button asChild variant="secondary">
          <Link href="/store">Hapus semua filter</Link>
        </Button>
      ) : null}
    </div>
  );
}
