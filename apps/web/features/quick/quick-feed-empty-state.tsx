/**
 * Empty state for the Quick feed (YT-0414). Unlike the earn board
 * (`campaign-empty-state.tsx`), Quick has no kind filter to relax — every
 * campaign this screen ever shows already passed the same
 * `kind === "quick"` cut in `quick-data.ts`, so an empty result here means
 * the catalogue itself currently has none, not a filter choice. The copy
 * reflects that: no "try a different filter" action, just an honest
 * "check back soon."
 */
export function QuickFeedEmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 p-6 text-center">
      <p className="text-base font-semibold text-fg">Belum ada video cepat saat ini</p>
      <p className="max-w-sm text-sm text-fg-muted">
        Daftar ini diperbarui secara berkala — coba kembali lagi sebentar lagi.
      </p>
    </div>
  );
}
