import { ancestorsOf } from "@yourtal/contracts/interest/taxonomy";
import type { Campaign } from "@yourtal/contracts/campaign";
import type { Audience } from "@yourtal/contracts/audience/audience";
import type { FeedItem, FeedWhyReason } from "@yourtal/contracts/feed";
import { toPoints } from "@yourtal/contracts/money";
import type { Region } from "@yourtal/contracts/region";
import type { CampaignRewardConfigRow } from "../campaign/persistence/campaign.repository";

/** "Ending soon" (EW-16): `endsAt` within 72h, or allocation remaining below 10%. */
const ENDING_SOON_HOURS = 72;
const ENDING_SOON_REMAINING_FRACTION = 0.1;

/** Score weights. Ordering between these matters far more than the exact numbers. */
const FOLLOWED_BOOST = 500;
const AUDIENCE_MATCH_BOOST = 200;
const INTEREST_MATCH_BOOST = 150;
const DEMOTED_PENALTY = -1_000;
const MAX_FRESHNESS_BOOST = 50;
const FRESHNESS_HALF_LIFE_DAYS = 7;

export interface CandidateCampaign {
  readonly campaign: Campaign;
  readonly rewardConfig: CampaignRewardConfigRow;
  readonly allocationRemainingPoints: number;
  readonly allocationTotalPoints: number;
}

export interface RankingContext {
  readonly now: Date;
  readonly viewerRegion: Region;
  /** The caller's full reach -- `["all_ages"]` anonymous, wider for a signed-in ageBand (7.4.d's own rule). */
  readonly audiences: readonly Audience[];
  readonly ageBand: "teen" | "adult" | undefined;
  readonly hasParentBoost: boolean;
  readonly followedBusinessIds: ReadonlySet<string>;
  readonly declaredInterestNodeIds: ReadonlySet<string>;
  /** Already the AND of "has ad-targeting consent" and "phase reached" -- see get-feed.use-case.ts. */
  readonly interestTargetingAllowed: boolean;
  readonly minSegmentSize: number;
  readonly segmentSizeOf: (nodeId: string) => number;
  readonly alreadyEarnedCampaignIds: ReadonlySet<string>;
  readonly demotedCampaignIds: ReadonlySet<string>;
  readonly canServe: (campaignId: string) => boolean;
  /** Anonymous (Open Viewing): only openViewing + all_ages, unpersonalised -- every boost above is skipped. */
  readonly anonymous: boolean;
  /**
   * 11.5.d: `channelHandle`/`channelLogoUrl` for a business, backed by a
   * pre-fetched batch lookup -- kept a plain sync function so `buildFeed`
   * stays pure and synchronous, same reasoning `segmentSizeOf`/`canServe`
   * already follow. `"unknown"` is defensive only: every campaign's
   * `businessId` is a real FK and every `business_accounts` row has a
   * `NOT NULL` handle, so a miss here would mean the pre-fetch itself was
   * wrong, never real seeded data.
   */
  readonly channelOf: (businessId: string) => { handle: string; logoUrl: string | null };
}

/** 7.7.a's filter. Every clause here is a reason a campaign never appears, full stop. */
export function passesFilter(candidate: CandidateCampaign, ctx: RankingContext): boolean {
  const { campaign } = candidate;
  if (campaign.status !== "active") return false;
  if (new Date(campaign.startsAt) > ctx.now || new Date(campaign.endsAt) < ctx.now) return false;
  if (campaign.region !== ctx.viewerRegion) return false;
  if (!ctx.audiences.includes(campaign.audience)) return false;
  if (ctx.anonymous && !campaign.openViewing) return false;
  if (!ctx.anonymous && ctx.alreadyEarnedCampaignIds.has(campaign.id)) return false;
  if (candidate.allocationRemainingPoints <= 0) return false;
  if (!ctx.canServe(campaign.id)) return false;
  return true;
}

function isEndingSoon(candidate: CandidateCampaign, now: Date): boolean {
  const hoursLeft = (new Date(candidate.campaign.endsAt).getTime() - now.getTime()) / 3_600_000;
  if (hoursLeft <= ENDING_SOON_HOURS) return true;
  const fraction = candidate.allocationRemainingPoints / candidate.allocationTotalPoints;
  return fraction < ENDING_SOON_REMAINING_FRACTION;
}

export interface Signals {
  readonly followed: boolean;
  readonly interestMatch: boolean;
  readonly audienceMatch: boolean;
  readonly demoted: boolean;
  readonly endingSoon: boolean;
}

/** Exported for `search.use-case.ts` -- a search result is a `FeedItem` too (same card), just unranked. */
export function signalsFor(candidate: CandidateCampaign, ctx: RankingContext): Signals {
  const { campaign } = candidate;
  if (ctx.anonymous) {
    return {
      followed: false,
      interestMatch: false,
      audienceMatch: false,
      demoted: false,
      endingSoon: isEndingSoon(candidate, ctx.now),
    };
  }
  const interestMatch =
    ctx.interestTargetingAllowed &&
    matchedInterestNodes(campaign).some(
      (nodeId) =>
        ctx.declaredInterestNodeIds.has(nodeId) && ctx.segmentSizeOf(nodeId) >= ctx.minSegmentSize,
    );
  const audienceMatch =
    (campaign.audience === "teen" && ctx.ageBand === "teen") ||
    (campaign.audience === "parents" && ctx.hasParentBoost);
  return {
    followed: ctx.followedBusinessIds.has(campaign.businessId),
    interestMatch,
    audienceMatch,
    demoted: ctx.demotedCampaignIds.has(campaign.id),
    // 12.4.d/#7: never a scarcity nudge for a teen -- no per-item flag, no
    // "Ending soon" why reason, and (`get-feed.use-case.ts`'s own caller,
    // `home-feed.tsx`) no row or tab for it either.
    endingSoon: ctx.ageBand === "teen" ? false : isEndingSoon(candidate, ctx.now),
  };
}

/**
 * 13.11.b: the interest nodes a campaign speaks to -- its category, its tags,
 * and each tag's ancestors, so a viewer who declared "coffee" matches a
 * campaign tagged "coffee-specialty". Exported for the segment-size pre-warm.
 */
export function matchedInterestNodes(campaign: Campaign): readonly string[] {
  const nodes = new Set<string>([campaign.contentCategory]);
  for (const tag of campaign.tags) {
    nodes.add(tag);
    for (const ancestor of ancestorsOf(tag)) nodes.add(ancestor);
  }
  return [...nodes];
}

function freshnessScore(campaign: Campaign, now: Date): number {
  const ageDays = (now.getTime() - new Date(campaign.publishedAt).getTime()) / 86_400_000;
  // Exponential decay -- halves every FRESHNESS_HALF_LIFE_DAYS, never negative.
  return MAX_FRESHNESS_BOOST * Math.pow(0.5, Math.max(ageDays, 0) / FRESHNESS_HALF_LIFE_DAYS);
}

function rewardPerMinute(candidate: CandidateCampaign): number {
  const minutes = candidate.campaign.durationSeconds / 60;
  return minutes <= 0 ? 0 : candidate.rewardConfig.rewardPointsPerCompletion / minutes;
}

function scoreOf(candidate: CandidateCampaign, signals: Signals, ctx: RankingContext): number {
  let score = rewardPerMinute(candidate) + freshnessScore(candidate.campaign, ctx.now);
  if (signals.followed) score += FOLLOWED_BOOST;
  if (signals.audienceMatch) score += AUDIENCE_MATCH_BOOST;
  if (signals.interestMatch) score += INTEREST_MATCH_BOOST;
  if (signals.demoted) score += DEMOTED_PENALTY;
  return score;
}

function whyReasonFor(signals: Signals): FeedWhyReason {
  if (signals.followed) return "followed";
  if (signals.interestMatch) return "interest";
  if (signals.audienceMatch) return "audience";
  if (signals.endingSoon) return "ending_soon";
  return "popular";
}

function whyFor(signals: Signals, campaign: Campaign): string {
  if (signals.followed) return `Because you follow ${campaign.merchantName}`;
  if (signals.interestMatch) return "Matches an interest you declared";
  if (signals.audienceMatch) return "Picked for you";
  if (signals.endingSoon) return "Ending soon";
  return "Popular right now";
}

export function toFeedItem(
  candidate: CandidateCampaign,
  signals: Signals,
  channel: { handle: string; logoUrl: string | null },
): FeedItem {
  const { campaign } = candidate;
  return {
    campaignId: campaign.id,
    businessId: campaign.businessId,
    merchantName: campaign.merchantName,
    title: campaign.title,
    synopsis: campaign.synopsis,
    posterUrl: campaign.posterUrl,
    teaserUrl: campaign.teaserUrl,
    durationSeconds: campaign.durationSeconds,
    // The funded base, not the campaign row's display number: the terms line must match the hold.
    rewardPoints: toPoints(candidate.rewardConfig.rewardPointsPerCompletion),
    kind: campaign.kind,
    questionCount: campaign.questionCount,
    maxRewardPoints: toPoints(
      candidate.rewardConfig.rewardPointsPerCompletion + candidate.rewardConfig.accuracyBonusPoints,
    ),
    estimatedDataMb: campaign.estimatedDataMb,
    contentCategory: campaign.contentCategory,
    tags: campaign.tags,
    audience: campaign.audience,
    region: campaign.region,
    openViewing: campaign.openViewing,
    endingSoon: signals.endingSoon,
    why: whyFor(signals, campaign),
    whyReason: whyReasonFor(signals),
    channelHandle: channel.handle,
    channelLogoUrl: channel.logoUrl,
    boosted: false,
  };
}

/**
 * Diversity (7.7.a): at most 2 in a row from one business. A single
 * stable pass -- when the next item would make a third in a row, the
 * nearest later item from a DIFFERENT business is pulled forward, and
 * everything between shifts back by one. O(n^2) worst case, fine for a
 * feed page (tens of items, not thousands).
 */
function applyDiversityCap<T extends { readonly businessId: string }>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = 2; i < result.length; i += 1) {
    const a = result[i - 2];
    const b = result[i - 1];
    const c = result[i];
    if (a === undefined || b === undefined || c === undefined) continue;
    if (a.businessId === b.businessId && b.businessId === c.businessId) {
      const swapIndex = result.findIndex(
        (candidate, index) => index > i && candidate.businessId !== a.businessId,
      );
      if (swapIndex !== -1) {
        const [moved] = result.splice(swapIndex, 1);
        if (moved !== undefined) result.splice(i, 0, moved);
      }
    }
  }
  return result;
}

/** The whole rules engine, given every signal already fetched. Pure and synchronous -- see get-feed.use-case.ts for the I/O. */
export function buildFeed(
  candidates: readonly CandidateCampaign[],
  ctx: RankingContext,
): readonly FeedItem[] {
  const scored = candidates
    .filter((candidate) => passesFilter(candidate, ctx))
    .map((candidate) => {
      const signals = signalsFor(candidate, ctx);
      return {
        item: toFeedItem(candidate, signals, ctx.channelOf(candidate.campaign.businessId)),
        score: scoreOf(candidate, signals, ctx),
        businessId: candidate.campaign.businessId,
      };
    })
    .sort((a, b) => b.score - a.score);

  return applyDiversityCap(scored).map((entry) => entry.item);
}
