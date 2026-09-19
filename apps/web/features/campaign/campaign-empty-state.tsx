import Link from "next/link";
import { Button } from "@yourtal/ui/button";
import type { CampaignKindFilter } from "./campaign-filter";

export interface CampaignEmptyStateProps {
  /** The active kind filter, so the copy can name what to relax rather than speaking generically. */
  kind: CampaignKindFilter;
}

/**
 * Empty state for the earn board (YT-0410). Per the brief, "empty is not
 * 'no results' text — it should say what to do next": this always names the
 * specific filter in play and gives one action that clears it, rather than
 * a bare "no campaigns found".
 */
export function CampaignEmptyState({ kind }: CampaignEmptyStateProps) {
  const filterLabel = kind === "long_form" ? "video panjang" : kind === "quick" ? "cepat" : null;

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <p className="text-base font-semibold text-fg">
        {filterLabel
          ? `Belum ada campaign ${filterLabel} saat ini`
          : "Belum ada campaign yang tersedia saat ini"}
      </p>
      <p className="max-w-sm text-sm text-fg-muted">
        {filterLabel
          ? "Coba tampilkan semua jenis campaign, atau kembali lagi sebentar lagi — daftar ini diperbarui secara berkala."
          : "Daftar ini diperbarui secara berkala — coba kembali lagi sebentar lagi."}
      </p>
      {filterLabel ? (
        <Button asChild variant="secondary">
          <Link href="/">Tampilkan semua campaign</Link>
        </Button>
      ) : null}
    </div>
  );
}
