import * as z from "zod/mini";
import { campaignSortKeys, DEFAULT_CAMPAIGN_SORT } from "./campaign-sort";
import { CAMPAIGN_KIND_FILTER_VALUES, DEFAULT_CAMPAIGN_KIND_FILTER } from "./campaign-filter";
import type { CampaignSortKey } from "./campaign-sort";
import type { CampaignKindFilter } from "./campaign-filter";

/**
 * Filter and sort state lives in the URL, not `useState`
 * (docs/13b-typescript-standards.md §8: "URL first ... shareable and
 * back-button-correct"). Next's `page.tsx` receives `searchParams` as
 * `Record<string, string | string[] | undefined>` — untrusted external
 * input per §3's "parse at every process boundary" — so it is parsed with
 * Zod here rather than trusted directly. An invalid or missing value falls
 * back to the documented default instead of erroring, because a stale or
 * hand-edited URL should degrade gracefully, not break the page.
 */
const rawSearchParamValueSchema = z.optional(z.union([z.string(), z.array(z.string())]));

const campaignBoardSearchParamsSchema = z.object({
  sort: rawSearchParamValueSchema,
  kind: rawSearchParamValueSchema,
});

export interface CampaignBoardParams {
  sort: CampaignSortKey;
  kind: CampaignKindFilter;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseCampaignBoardParams(searchParams: Record<string, string | string[] | undefined>): CampaignBoardParams {
  const raw = campaignBoardSearchParamsSchema.parse(searchParams);

  const sortCandidate = firstValue(raw.sort);
  const sort = (campaignSortKeys as readonly string[]).includes(sortCandidate ?? "")
    ? (sortCandidate as CampaignSortKey)
    : DEFAULT_CAMPAIGN_SORT;

  const kindCandidate = firstValue(raw.kind);
  const kind = (CAMPAIGN_KIND_FILTER_VALUES as readonly string[]).includes(kindCandidate ?? "")
    ? (kindCandidate as CampaignKindFilter)
    : DEFAULT_CAMPAIGN_KIND_FILTER;

  return { sort, kind };
}

/**
 * Builds the query string for the board with one field changed, preserving
 * the rest — used by the client-side filter/sort controls so a change to
 * one control never drops the other's selection from the URL.
 */
export function buildCampaignBoardQuery(current: CampaignBoardParams, update: Partial<CampaignBoardParams>): string {
  const next: CampaignBoardParams = { ...current, ...update };
  const params = new URLSearchParams();
  if (next.sort !== DEFAULT_CAMPAIGN_SORT) {
    params.set("sort", next.sort);
  }
  if (next.kind !== DEFAULT_CAMPAIGN_KIND_FILTER) {
    params.set("kind", next.kind);
  }
  const query = params.toString();
  return query.length > 0 ? `?${query}` : "";
}
