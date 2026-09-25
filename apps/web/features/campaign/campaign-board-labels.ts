import { CAMPAIGN_KIND_FILTER_OPTIONS, type CampaignKindFilter } from "./campaign-filter";
import { getCampaignTranslator, type SupportedLocale } from "./campaign-i18n";
import { CAMPAIGN_SORT_OPTIONS, type CampaignSortKey } from "./campaign-sort";

export interface CampaignBoardLabels {
  readonly title: string;
  readonly filterAria: string;
  readonly sortLabel: string;
  readonly sortAria: string;
  readonly kinds: Readonly<Record<CampaignKindFilter, string>>;
  readonly sorts: Readonly<Record<CampaignSortKey, string>>;
}

/** Resolved on the server so the client controls ship no catalogue. */
export function getCampaignBoardLabels(locale: SupportedLocale): CampaignBoardLabels {
  const t = getCampaignTranslator(locale);
  return {
    title: t("board.title"),
    filterAria: t("board.filterAria"),
    sortLabel: t("board.sortLabel"),
    sortAria: t("board.sortAria"),
    kinds: Object.fromEntries(
      CAMPAIGN_KIND_FILTER_OPTIONS.map((o) => [o.key, t(`board.${o.labelKey}`)]),
    ) as Record<CampaignKindFilter, string>,
    sorts: Object.fromEntries(
      CAMPAIGN_SORT_OPTIONS.map((o) => [o.key, t(`board.${o.labelKey}`)]),
    ) as Record<CampaignSortKey, string>,
  };
}
