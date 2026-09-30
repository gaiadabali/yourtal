import type { Principal } from "@yourtal/authz/principal";
import { isBoostedForParents } from "@yourtal/contracts/audience/audience";
import type { FeedFacets, FeedItem, FeedSurface } from "@yourtal/contracts/feed";
import type { Region } from "@yourtal/contracts/region";
import { mayUseSignalFor } from "@yourtal/consent/consent-query";
import type { CampaignRepository } from "../../campaign/persistence/campaign.repository";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import type { RegionSettingsReader } from "../../../shared/settings/region-settings-reader";
import { resolveCatalogueScope } from "../../store/catalogue-scope";
import type { ChannelLookupRepository } from "../persistence/channel-lookup.repository";
import type { FeedSignalsRepository } from "../persistence/feed-signals.repository";
import type { PacingStateRepository } from "../persistence/pacing-state.repository";
import type { SuspendedBusinessLookup } from "../persistence/suspended-business-lookup";
import { buildFeed, matchedInterestNodes } from "../ranking";
import { fetchFundedCampaigns } from "../candidates";
import { applyFeedBrowse, feedFacets } from "../browse";
import type { FeedBrowseFilter } from "../browse";
import type { CandidateCampaign } from "../ranking";
import { placeBoosted, runBoostAuction } from "../boost/boost-auction";
import type { BoostAward } from "../boost/boost-auction";
import type { BoostRepository } from "../boost/boost.repository";
import { reserveCpmFor } from "../boost/boost-reserve";

export type BoostSlots = Pick<BoostRepository, "bidsFor" | "recordWin">;

/** 11.5.d: defensive fallback only -- see `RankingContext.channelOf`'s own comment. */
const UNKNOWN_CHANNEL = { handle: "unknown", logoUrl: null } as const;

/** Interest node docs/16 D3 uses for the "declared parent of young children" boost -- see audience.ts's own comment. */
const PARENT_OF_YOUNG_CHILDREN_NODE = "family-young-children";
const DEFAULT_MIN_SEGMENT_SIZE = 1_000;

/**
 * 7.5.a's own "P_issue appears only here, never on consumer surfaces" is the
 * shape this follows too: this module is the first apps/api caller of
 * `@yourtal/consent`'s decision API, so the phase this platform is in has
 * no other source yet -- hardcoded here the same way `cohort-floor.ts` and
 * `fake-ledger-pricing.ts`'s pack prices are, until something owns it.
 */
const CURRENT_CONSENT_PHASE = "P1" as const;

export interface FeedResult {
  readonly surface: FeedSurface;
  readonly items: readonly FeedItem[];
  readonly facets: FeedFacets;
}

/**
 * 13.12.a: facets over the walled set, then the viewer's filters and sort.
 * Only what is returned counts as served for pacing. A teen never gets the
 * "ending soon" ordering (12.4.d: no scarcity nudges), so it falls back to
 * the ranked order.
 */
async function finish(
  surface: FeedSurface,
  ranked: readonly FeedItem[],
  candidates: readonly CandidateCampaign[],
  browse: FeedBrowseFilter,
  pacing: PacingStateRepository,
  teen: boolean,
  boost:
    | {
        readonly slots: BoostSlots;
        readonly settings: RegionSettingsReader;
        readonly region: Region;
      }
    | undefined,
): Promise<FeedResult> {
  const byId = new Map(candidates.map((candidate) => [candidate.campaign.id, candidate.campaign]));
  const time = (iso: string | undefined) => (iso === undefined ? 0 : new Date(iso).getTime());
  const effective: FeedBrowseFilter =
    teen && browse.sort === "ending_soon" ? { ...browse, sort: "for_you" } : browse;
  const items = applyFeedBrowse(ranked, effective, {
    publishedAt: (id) => time(byId.get(id)?.publishedAt),
    endsAt: (id) => time(byId.get(id)?.endsAt),
  });
  const served =
    boost !== undefined && surface === "home" && effective.sort === "for_you" && !teen
      ? await fillBoostSlots(items, boost)
      : items;
  for (const item of served) await pacing.recordServe(item.campaignId);
  return { surface, items: served, facets: feedFacets(ranked, effective) };
}

/**
 * 13.23.b: Home's reserved slots go to the highest boost bid among cards the
 * viewer could already see; a teen's feed and any filtered or sorted view
 * carry none. A win is kept only if the budget row accepts it.
 */
async function fillBoostSlots(
  items: FeedItem[],
  boost: {
    readonly slots: BoostSlots;
    readonly settings: RegionSettingsReader;
    readonly region: Region;
  },
): Promise<FeedItem[]> {
  const bids = await boost.slots.bidsFor(
    boost.region,
    items.map((item) => item.campaignId),
  );
  if (bids.length === 0) return items;
  const reserve = await reserveCpmFor(boost.settings, boost.region);
  const kept: BoostAward[] = [];
  for (const award of runBoostAuction(bids, reserve)) {
    const booked = await boost.slots.recordWin(
      boost.region,
      award.campaignId,
      award.slot,
      award.priceCpmMinor,
    );
    if (booked) kept.push({ ...award, slot: kept.length });
  }
  return placeBoosted(items, kept);
}

export async function getFeed(
  campaigns: CampaignRepository,
  ledger: Pick<LedgerInternalClient, "getAllocation">,
  pacing: PacingStateRepository,
  signals: FeedSignalsRepository,
  settings: RegionSettingsReader,
  suspendedBusinesses: SuspendedBusinessLookup,
  channels: ChannelLookupRepository,
  principal: Principal,
  surface: FeedSurface,
  queryRegion: Region | undefined,
  browse: FeedBrowseFilter = { sort: "for_you" },
  boostSlots?: BoostSlots,
): Promise<
  { readonly kind: "ok"; readonly result: FeedResult } | { readonly kind: "region_required" }
> {
  const scope = resolveCatalogueScope(principal, queryRegion);
  if (scope.kind === "anonymous_region_required") return { kind: "region_required" };
  // A signed-in caller stating a region that disagrees with their own sees
  // an empty feed, same as the catalogue -- never a silent override.
  const region = scope.kind === "region_mismatch" ? undefined : scope.region;
  const audiences = scope.kind === "region_mismatch" ? [] : scope.audiences;

  const anonymous = principal.id === "anonymous";
  const ageBand = anonymous ? undefined : principal.attr.ageBand;

  const candidates =
    region === undefined
      ? []
      : await fetchFundedCampaigns(campaigns, ledger, suspendedBusinesses, region);

  const canServeMap = new Map(
    await Promise.all(
      candidates.map(async (candidate): Promise<[string, boolean]> => [
        candidate.campaign.id,
        await pacing.canServe(candidate.campaign.id),
      ]),
    ),
  );

  const channelMap = await channels.channelsFor(
    candidates.map((candidate) => candidate.campaign.businessId),
  );
  const channelOf = (businessId: string) => channelMap.get(businessId) ?? UNKNOWN_CHANNEL;

  if (anonymous || region === undefined) {
    const items = buildFeed(candidates, {
      now: new Date(),
      viewerRegion: region ?? "AU",
      audiences: audiences.length > 0 ? audiences : ["all_ages"],
      ageBand: undefined,
      hasParentBoost: false,
      followedBusinessIds: new Set(),
      declaredInterestNodeIds: new Set(),
      interestTargetingAllowed: false,
      minSegmentSize: DEFAULT_MIN_SEGMENT_SIZE,
      segmentSizeOf: () => 0,
      alreadyEarnedCampaignIds: new Set(),
      demotedCampaignIds: new Set(),
      canServe: (id) => canServeMap.get(id) ?? true,
      anonymous: true,
      channelOf,
    });
    return {
      kind: "ok",
      result: await finish(
        surface,
        items,
        candidates,
        browse,
        pacing,
        false,
        region === undefined || boostSlots === undefined
          ? undefined
          : { slots: boostSlots, settings, region },
      ),
    };
  }

  const [
    followedBusinessIds,
    declaredInterestNodeIds,
    consentRecords,
    alreadyEarned,
    demoted,
    minSegmentSetting,
  ] = await Promise.all([
    signals.followedBusinessIds(principal.id),
    signals.declaredInterestNodeIds(principal.id),
    signals.consentRecordsFor(principal.id),
    signals.alreadyEarnedCampaignIds(principal.id),
    signals.demotedCampaignIds(principal.id),
    settings.getSetting<number>(region, "interest_targeting_min_segment"),
  ]);

  const interestTargetingAllowed = mayUseSignalFor({
    purpose: "declared_interest_targeting",
    jurisdiction: region,
    records: consentRecords,
    currentPhase: CURRENT_CONSENT_PHASE,
    // 12.1.c: unaffected for THIS purpose (declared interests stay open to
    // a teen) -- passed through so this call site already agrees with
    // `mayUseSignalFor`'s own contract the day a caller here asks about
    // `behavioural_profiling`/`purchase_history_targeting` instead.
    // Conditionally spread, not `ageBand,` directly -- `exactOptionalPropertyTypes`
    // (docs/13b §1) treats a key present with value `undefined` differently
    // from an absent key, and `ConsentQuery.ageBand` is typed to require the
    // latter.
    ...(ageBand === undefined ? {} : { ageBand }),
  }).allowed;

  const segmentCache = new Map<string, number>();
  const segmentSizeOf = async (nodeId: string): Promise<number> => {
    const cached = segmentCache.get(nodeId);
    if (cached !== undefined) return cached;
    const size = await signals.segmentSizeFor(nodeId);
    segmentCache.set(nodeId, size);
    return size;
  };
  // Pre-warm the cache for every interest node in play (13.11.b: category,
  // tags and their ancestors) that the viewer declared, so `buildFeed`'s own
  // segmentSizeOf can stay synchronous.
  const declared = new Set(declaredInterestNodeIds);
  const nodesInPlay = new Set(
    candidates.flatMap((candidate) => matchedInterestNodes(candidate.campaign)),
  );
  await Promise.all(
    [...nodesInPlay].filter((node) => declared.has(node)).map((node) => segmentSizeOf(node)),
  );

  const hasParentBoost = isBoostedForParents({
    ageBand: ageBand ?? "adult",
    hasParentOfYoungChildrenInterest: declaredInterestNodeIds.includes(
      PARENT_OF_YOUNG_CHILDREN_NODE,
    ),
    hasAdTargetingConsent: interestTargetingAllowed,
  });

  const items = buildFeed(candidates, {
    now: new Date(),
    viewerRegion: region,
    audiences,
    ageBand,
    hasParentBoost,
    followedBusinessIds,
    declaredInterestNodeIds: new Set(declaredInterestNodeIds),
    interestTargetingAllowed,
    minSegmentSize: minSegmentSetting ?? DEFAULT_MIN_SEGMENT_SIZE,
    segmentSizeOf: (nodeId) => segmentCache.get(nodeId) ?? 0,
    alreadyEarnedCampaignIds: alreadyEarned,
    demotedCampaignIds: demoted,
    canServe: (id) => canServeMap.get(id) ?? true,
    anonymous: false,
    channelOf,
  });
  return {
    kind: "ok",
    result: await finish(
      surface,
      items,
      candidates,
      browse,
      pacing,
      ageBand === "teen",
      boostSlots === undefined ? undefined : { slots: boostSlots, settings, region },
    ),
  };
}
