import Link from "next/link";
import { Button } from "@yourtal/ui/button";
import type { CampaignKindFilter } from "./campaign-filter";
import { getCampaignTranslator, type SupportedLocale } from "./campaign-i18n";

export interface CampaignEmptyStateProps {
  /** The active kind filter, so the copy can name what to relax rather than speaking generically. */
  kind: CampaignKindFilter;
  /** YT-0405: required, not defaulted — see store-empty-state.tsx. */
  locale: SupportedLocale;
}

/**
 * Empty state for the earn board (YT-0410). Per the brief, "empty is not
 * 'no results' text — it should say what to do next": this always names the
 * specific filter in play and gives one action that clears it, rather than
 * a bare "no campaigns found".
 */
export function CampaignEmptyState({ kind, locale }: CampaignEmptyStateProps) {
  // YT-0405: never on the original untranslated list, still fully Indonesian.
  const t = getCampaignTranslator(locale);
  const filterLabel =
    kind === "long_form"
      ? t("campaign.kindLongForm")
      : kind === "quick"
        ? t("campaign.kindQuick")
        : null;

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <p className="text-base font-semibold text-fg">
        {filterLabel ? t("campaign.emptyFiltered", { filterLabel }) : t("campaign.emptyNone")}
      </p>
      <p className="max-w-sm text-sm text-fg-muted">
        {filterLabel ? t("campaign.emptyFilteredBody") : t("campaign.emptyNoneBody")}
      </p>
      {filterLabel ? (
        <Button asChild variant="secondary">
          <Link href="/">{t("campaign.emptyShowAll")}</Link>
        </Button>
      ) : null}
    </div>
  );
}
