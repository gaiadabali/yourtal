import type { Principal } from "@yourtal/authz/principal";
import { isBoostedForParents } from "@yourtal/contracts/audience/audience";
import type { FeedItem, FeedSurface } from "@yourtal/contracts/feed";
import type { Region } from "@yourtal/contracts/region";
import { mayUseSignalFor } from "@yourtal/consent/consent-query";
import type { CampaignRepository } from "../../campaign/persistence/campaign.repository";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import type { RegionSettingsReader } from "../../../shared/settings/region-settings-reader";
import { resolveCatalogueScope } from "../../store/catalogue-scope";
import type { FeedSignalsRepository } from "../persistence/feed-signals.repository";
import type { PacingStateRepository } from "../persistence/pacing-state.repository";
import type { SuspendedBusinessLookup } from "../persistence/suspended-business-lookup";
import { buildFeed } from "../ranking";
import { fetchFundedCampaigns } from "../candidates";

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
}

export async function getFeed(
  campaigns: CampaignRepository,
  ledger: Pick<LedgerInternalClient, "getAllocation">,
  pacing: PacingStateRepository,
  signals: FeedSignalsRepository,
  settings: RegionSettingsReader,
  suspendedBusinesses: SuspendedBusinessLookup,
  principal: Principal,
  surface: FeedSurface,
  queryRegion: Region | undefined,
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
    });
    for (const item of items) await pacing.recordServe(item.campaignId);
    return { kind: "ok", result: { surface, items } };
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
  }).allowed;

  const segmentCache = new Map<string, number>();
  const segmentSizeOf = async (nodeId: string): Promise<number> => {
    const cached = segmentCache.get(nodeId);
    if (cached !== undefined) return cached;
    const size = await signals.segmentSizeFor(nodeId);
    segmentCache.set(nodeId, size);
    return size;
  };
  // Pre-warm the cache for every content category actually in play, so
  // `buildFeed`'s own segmentSizeOf can stay synchronous.
  const categories = [
    ...new Set(candidates.map((candidate) => candidate.campaign.contentCategory)),
  ];
  await Promise.all(categories.map((category) => segmentSizeOf(category)));

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
  });
  for (const item of items) await pacing.recordServe(item.campaignId);
  return { kind: "ok", result: { surface, items } };
}
