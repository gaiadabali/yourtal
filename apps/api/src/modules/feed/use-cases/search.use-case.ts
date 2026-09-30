import type { Principal } from "@yourtal/authz/principal";
import type { SearchResponse } from "@yourtal/contracts/feed";
import type { Region } from "@yourtal/contracts/region";
import type { CampaignKind } from "@yourtal/contracts/campaign";
import type { ContentCategory } from "@yourtal/jurisdiction/content-category";
import type { CampaignRepository } from "../../campaign/persistence/campaign.repository";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import type { ListingRepository } from "../../store/persistence/listing.repository";
import { resolveCatalogueScope } from "../../store/catalogue-scope";
import type { ChannelSearchRepository } from "../persistence/channel-search.repository";
import type { ChannelLookupRepository } from "../persistence/channel-lookup.repository";
import type { SuspendedBusinessLookup } from "../persistence/suspended-business-lookup";
import { fetchFundedCampaigns } from "../candidates";
import { passesFilter, signalsFor, toFeedItem } from "../ranking";
import type { RankingContext } from "../ranking";

const SEARCH_LIMIT = 20;
/** 11.5.d: defensive fallback only -- see `RankingContext.channelOf`'s own comment. */
const UNKNOWN_CHANNEL = { handle: "unknown", logoUrl: null } as const;

/**
 * 7.7.c: campaigns, channels (businesses) and listings, one query string,
 * region- and audience-walled the same way 7.4.d's catalogue is -- signed-in
 * principal first, anonymous path region with all_ages. Unlike the feed,
 * search never ranks by follow/interest/freshness: a query is already an
 * explicit ask, so this only filters (funded, live, in-scope, matching text)
 * and returns matches in the repositories' own order.
 */
export async function search(
  campaigns: CampaignRepository,
  ledger: Pick<LedgerInternalClient, "getAllocation">,
  channels: ChannelSearchRepository,
  listings: Pick<ListingRepository, "browsePublic">,
  suspendedBusinesses: SuspendedBusinessLookup,
  channelLookup: ChannelLookupRepository,
  principal: Principal,
  query: string,
  queryRegion: Region | undefined,
  /** 13.12.c: `kind` narrows campaigns only; `category` narrows campaigns and listings. */
  narrow: {
    readonly kind?: CampaignKind | undefined;
    readonly category?: ContentCategory | undefined;
  } = {},
): Promise<
  { readonly kind: "ok"; readonly result: SearchResponse } | { readonly kind: "region_required" }
> {
  const scope = resolveCatalogueScope(principal, queryRegion);
  if (scope.kind === "anonymous_region_required") return { kind: "region_required" };
  if (scope.kind === "region_mismatch") {
    return { kind: "ok", result: { campaigns: [], channels: [], listings: [] } };
  }

  const { region, audiences } = scope;
  const anonymous = principal.id === "anonymous";
  const needle = query.toLowerCase();

  const candidates = await fetchFundedCampaigns(campaigns, ledger, suspendedBusinesses, region);
  const channelMap = await channelLookup.channelsFor(
    candidates.map((candidate) => candidate.campaign.businessId),
  );
  const channelOf = (businessId: string) => channelMap.get(businessId) ?? UNKNOWN_CHANNEL;
  const ctx: RankingContext = {
    now: new Date(),
    viewerRegion: region,
    audiences,
    ageBand: undefined,
    hasParentBoost: false,
    followedBusinessIds: new Set(),
    declaredInterestNodeIds: new Set(),
    interestTargetingAllowed: false,
    minSegmentSize: 0,
    segmentSizeOf: () => 0,
    alreadyEarnedCampaignIds: new Set(),
    demotedCampaignIds: new Set(),
    canServe: () => true,
    anonymous,
    channelOf,
  };
  const matchingCampaigns = candidates
    .filter((candidate) => passesFilter(candidate, ctx))
    .filter((candidate) => narrow.kind === undefined || candidate.campaign.kind === narrow.kind)
    .filter(
      (candidate) =>
        narrow.category === undefined || candidate.campaign.contentCategory === narrow.category,
    )
    .filter(
      (candidate) =>
        candidate.campaign.title.toLowerCase().includes(needle) ||
        candidate.campaign.synopsis.toLowerCase().includes(needle) ||
        candidate.campaign.merchantName.toLowerCase().includes(needle),
    )
    .slice(0, SEARCH_LIMIT)
    .map((candidate) =>
      toFeedItem(
        candidate,
        signalsFor(candidate, ctx),
        ctx.channelOf(candidate.campaign.businessId),
      ),
    );

  const [channelResults, listingPage] = await Promise.all([
    channels.search(query, region, SEARCH_LIMIT),
    listings.browsePublic({
      region,
      audiences,
      search: query,
      contentCategory: narrow.category,
      sort: "popular",
      limit: SEARCH_LIMIT,
    }),
  ]);

  return {
    kind: "ok",
    result: {
      campaigns: matchingCampaigns,
      channels: [...channelResults],
      listings: [...listingPage.listings],
    },
  };
}
