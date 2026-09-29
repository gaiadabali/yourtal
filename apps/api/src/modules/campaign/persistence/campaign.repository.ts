import type { Audience, Campaign } from "@yourtal/contracts/campaign";
import type { CampaignTerms } from "@yourtal/contracts/campaign/campaign-terms";
import type { Region } from "@yourtal/contracts/region";

/**
 * Reading campaigns for a viewer. YT-0553.
 *
 * ## The authoring state never leaves this layer
 *
 * `campaign.campaigns.lifecycle_state` carries `draft`, `in_review` and
 * `rejected` as well as the three a viewer can see. None of those three may
 * reach a response: a draft appearing on the Earn board discloses
 * unpublished work, and a rejection reason discloses a moderation decision
 * to the public.
 *
 * So the repository returns `Campaign` — the viewer-facing contract, whose
 * `status` is `active | paused | ended` and which has no field capable of
 * carrying an authoring state. The mapping happens once, here, through
 * `publicStatusOf`, and a campaign with no public form is simply not
 * returned. Making the wrong thing **unrepresentable in the return type** is
 * stronger than remembering to filter in each controller.
 */
export interface CampaignRepository {
  /**
   * Campaigns a viewer may see, newest first. Never drafts.
   *
   * `audiences` (12.1.b), when given, additionally filters to campaigns
   * whose `audience` this viewer's `ageBand` reaches --
   * `@yourtal/contracts/audience`'s `reachableAudiences`, the same list
   * every other consumer surface derives from. Omitted by
   * `fetchFundedCampaigns` (feed/search): those already filter downstream
   * in `ranking.ts`'s own `passesFilter`, against candidates that also need
   * ranking signals this repository does not have -- filtering here too
   * would just be the same check twice. `CampaignController.list` (a plain,
   * unranked read with no ranking context) is the one caller that filters
   * here instead, because there is nothing downstream of it that would.
   *
   * `region` (12.1.f), when given, additionally filters to campaigns in
   * exactly that region -- F2's hard wall. `CampaignController.list` derives
   * it from `resolveCatalogueScope` (the caller's own `jurisdiction` when
   * signed in, the required `region` query param when anonymous), the same
   * source every other public list already uses. Omitted the same way
   * `audiences` is: `fetchFundedCampaigns` filters its own candidates
   * downstream instead.
   */
  listVisible(
    limit: number,
    audiences?: readonly Audience[],
    region?: Region,
  ): Promise<Campaign[]>;
  /** One campaign, or `null` if it does not exist or is not public. */
  findVisibleById(campaignId: string): Promise<Campaign | null>;
  /**
   * 11.5.a/11.5.d: one business's own visible campaigns, newest first --
   * the watch page's "more from this channel" and the `/c/[handle]` channel
   * page's campaign grid. Same visibility rule as `listVisible`, just
   * narrowed to one `businessId` -- including the same optional `audiences`
   * filter (12.1.b): a channel page is public browse, so it needs the same
   * audience wall the plain campaign list has, or a teen/anonymous visitor
   * sees an adult-only campaign there that `GET /api/campaigns` already hid.
   */
  listVisibleByBusiness(
    businessId: string,
    limit: number,
    audiences?: readonly Audience[],
  ): Promise<Campaign[]>;
  /**
   * The terms version currently in force, for starting a watch session.
   * `null` when the campaign has no terms — which the migration makes
   * impossible for a seeded campaign, but a read must still answer honestly.
   */
  currentTermsVersion(campaignId: string): Promise<number | null>;
  /** Whether this campaign can still pay out. `live` only, not `paused`. */
  isLive(campaignId: string): Promise<boolean>;
  /**
   * The FROZEN terms a session entered under (EW-20). A watch session's
   * duration, question count, scoring rule and reward figures must always
   * come from here — the version named on the session row — never from the
   * campaign's CURRENT config, which an advertiser may have edited since.
   * `null` only if the (campaignId, version) pair does not exist, which a
   * session's own composite foreign key makes impossible in practice.
   */
  termsVersionDetails(campaignId: string, version: number): Promise<CampaignTerms | null>;
  /**
   * The partner's funding link for this campaign (5.1.b, 5.3.a):
   * `campaign.reward_config`. `null` when the campaign has none configured
   * yet (a campaign authored before 7.1 wires this, or one that pays
   * nothing) — a session on such a campaign starts non-earning rather than
   * failing outright.
   */
  rewardConfigFor(campaignId: string): Promise<CampaignRewardConfigRow | null>;
}

export interface CampaignRewardConfigRow {
  readonly campaignId: string;
  readonly allocationId: string;
  readonly funderType: "partner" | "marketing";
  readonly maxPointsForCampaign: number;
  readonly rewardPointsPerCompletion: number;
  readonly accuracyBonusPoints: number;
}

export const CAMPAIGN_REPOSITORY = Symbol("CAMPAIGN_REPOSITORY");
