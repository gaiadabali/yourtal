import type { Campaign } from "@yourtal/contracts/campaign";
import type { CampaignTerms } from "@yourtal/contracts/campaign/campaign-terms";

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
  /** Campaigns a viewer may see, newest first. Never drafts. */
  listVisible(limit: number): Promise<Campaign[]>;
  /** One campaign, or `null` if it does not exist or is not public. */
  findVisibleById(campaignId: string): Promise<Campaign | null>;
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
