import type { Campaign } from "@yourtal/contracts/campaign";

/**
 * Sort controls for the earn board (YT-0410). docs/17-surfaces-and-roles.md
 * §1 specifies the board is "sorted by expected value to *this* user" —
 * `"value"` below is that default, and is exposed alongside a few explicit
 * alternatives rather than being the only option, because "best for you"
 * and "shortest commitment" are both legitimate ways a user picks what to
 * do with their next few minutes.
 */
export const campaignSortKeys = ["value", "reward", "duration", "newest"] as const;
export type CampaignSortKey = (typeof campaignSortKeys)[number];

export const DEFAULT_CAMPAIGN_SORT: CampaignSortKey = "value";

export const CAMPAIGN_SORT_OPTIONS: ReadonlyArray<{ key: CampaignSortKey; label: string }> = [
  { key: "value", label: "Nilai terbaik" },
  { key: "reward", label: "Reward tertinggi" },
  { key: "duration", label: "Durasi tersingkat" },
  { key: "newest", label: "Terbaru" },
];

export function isCampaignSortKey(value: string): value is CampaignSortKey {
  return (campaignSortKeys as readonly string[]).includes(value);
}

/**
 * Points earned per minute of commitment — the expected-value proxy behind
 * the default "value" sort. Duration is used as the cost proxy (rather than
 * estimated MB) because data cost scales with duration for a fixed quality
 * target, and duration is what the user actually trades.
 */
export function expectedValuePerMinute(campaign: Campaign): number {
  const minutes = campaign.durationSeconds / 60;
  return minutes > 0 ? campaign.rewardPoints / minutes : 0;
}

/** Sorts a copy of `campaigns`; never mutates the input array. */
export function sortCampaigns(campaigns: readonly Campaign[], sort: CampaignSortKey): Campaign[] {
  const sorted = [...campaigns];
  switch (sort) {
    case "value":
      return sorted.sort((a, b) => expectedValuePerMinute(b) - expectedValuePerMinute(a));
    case "reward":
      return sorted.sort((a, b) => b.rewardPoints - a.rewardPoints);
    case "duration":
      return sorted.sort((a, b) => a.durationSeconds - b.durationSeconds);
    case "newest":
      return sorted.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    default: {
      const exhaustive: never = sort;
      throw new Error(`Unhandled campaign sort key: ${String(exhaustive)}`);
    }
  }
}
