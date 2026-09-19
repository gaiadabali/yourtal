import type { Campaign, CampaignKind } from "@yourtal/contracts/campaign";

/**
 * Kind filter for the earn board (YT-0410). "all" is the extra option on
 * top of the two real `CampaignKind` values from the contract.
 */
/**
 * Spelled out rather than derived from `campaignKindSchema.options`. This
 * module is reachable from the client leaf `campaign-board-controls.tsx`,
 * and a *value* import from `@yourtal/contracts/campaign` drags the whole
 * Zod runtime (~96 KB gz) into the earn board's bundle, breaking the 170 KB
 * initial-JS gate (docs/13b-typescript-standards.md section 8).
 *
 * The two checks below keep this list welded to the contract: `satisfies`
 * rejects a value that is not a real `CampaignKind`, and `MissingKind`
 * fails to compile if a kind is ever added to the contract and not here.
 */
const CAMPAIGN_KINDS = ["long_form", "quick"] as const satisfies readonly CampaignKind[];

type MissingKind = Exclude<CampaignKind, (typeof CAMPAIGN_KINDS)[number]>;
const _allKindsCovered: MissingKind extends never ? true : never = true;

export const CAMPAIGN_KIND_FILTER_VALUES = ["all", ...CAMPAIGN_KINDS] as const;
export type CampaignKindFilter = (typeof CAMPAIGN_KIND_FILTER_VALUES)[number];

export const DEFAULT_CAMPAIGN_KIND_FILTER: CampaignKindFilter = "all";

export const CAMPAIGN_KIND_FILTER_OPTIONS: ReadonlyArray<{ key: CampaignKindFilter; label: string }> = [
  { key: "all", label: "Semua" },
  { key: "long_form", label: "Video panjang" },
  { key: "quick", label: "Cepat" },
];

export function isCampaignKindFilter(value: string): value is CampaignKindFilter {
  return (CAMPAIGN_KIND_FILTER_VALUES as readonly string[]).includes(value);
}

export function filterCampaignsByKind(campaigns: readonly Campaign[], kind: CampaignKindFilter): Campaign[] {
  if (kind === "all") {
    return [...campaigns];
  }
  const wanted: CampaignKind = kind;
  return campaigns.filter((campaign) => campaign.kind === wanted);
}
