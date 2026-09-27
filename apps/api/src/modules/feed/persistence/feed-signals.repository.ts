import type { ConsentRecord } from "@yourtal/consent/consent-record";

/**
 * 7.7: every per-viewer ranking signal the feed reads from OTHER modules'
 * tables (`me.follow`, `me.interest`, `identity.consent_record`,
 * `watch.session`), plus `feed.demotion` (this module's own). Raw SQL, not
 * those modules' own Drizzle tables or repositories -- `me`'s repositories
 * are not exported from `MeModule` (they are not meant to be, per that
 * module's own boundary), and `watch.session` belongs to a module this
 * session must not edit. Same shape `reports` already used for
 * `campaign.campaigns`/`watch.session`.
 */
export interface FeedSignalsRepository {
  followedBusinessIds(userId: string): Promise<ReadonlySet<string>>;
  declaredInterestNodeIds(userId: string): Promise<readonly string[]>;
  consentRecordsFor(userId: string): Promise<readonly ConsentRecord[]>;
  /** How many distinct users have declared this interest node at all -- the F12 targeting-minimum segment check. */
  segmentSizeFor(nodeId: string): Promise<number>;
  /** Campaign ids this user has already earned a reward from (`watch.session.granted`). */
  alreadyEarnedCampaignIds(userId: string): Promise<ReadonlySet<string>>;
  demotedCampaignIds(userId: string): Promise<ReadonlySet<string>>;
  demote(userId: string, campaignId: string): Promise<void>;
}

export const FEED_SIGNALS_REPOSITORY = Symbol("FEED_SIGNALS_REPOSITORY");
