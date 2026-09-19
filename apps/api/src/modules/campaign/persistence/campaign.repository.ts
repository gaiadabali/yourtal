import type { Campaign } from "@yourtal/contracts/campaign";

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
}

export const CAMPAIGN_REPOSITORY = Symbol("CAMPAIGN_REPOSITORY");
