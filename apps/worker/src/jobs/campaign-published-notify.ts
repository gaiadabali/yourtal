import type { Pool } from "pg";
import { createPool } from "../pool";
import type { Job } from "pg-boss";
import { CAMPAIGN_PUBLISHED_QUEUE } from "@yourtal/contracts/studio/campaign-published-event";
import type { CampaignPublishedEvent } from "@yourtal/contracts/studio/campaign-published-event";
import { reachesAudience } from "@yourtal/contracts/audience/audience";
import type { Audience } from "@yourtal/contracts/audience/audience";
import { isQuietHours } from "@yourtal/contracts/me/quiet-hours";
import { ageBandFrom, ageYearsFrom } from "@yourtal/jurisdiction/age";
import { createSimulatedPush } from "@yourtal/drivers/push";
import { defineJob } from "../job";
import type { JobContext } from "../job";
import { isPushEnabledFor } from "../push-default";

/**
 * TASKS.md 7.3.g (moved from 5.5.b by F40): turns a `campaign.published`
 * event (7.3.f — emitted the moment a campaign's lifecycle_state becomes
 * `live`) into a `me.notification` row plus a simulated push for every
 * follower of that business in its own region. Modelled directly on
 * `points-unlocked-notify.ts` — same raw-`pg` reasoning (no Drizzle client
 * in `apps/worker`), same notification-preference read before pushing.
 */
let pool: Pool | undefined;
function poolFor(databaseUrl: string): Pool {
  pool ??= createPool(databaseUrl);
  return pool;
}

const push = createSimulatedPush();

const CATEGORY = "campaign_published";

export const job = defineJob<CampaignPublishedEvent>({
  queue: CAMPAIGN_PUBLISHED_QUEUE,
  async handle(jobRecord: Job<CampaignPublishedEvent>, { config }: JobContext) {
    const event = jobRecord.data;
    const client = poolFor(config.databaseUrl);

    // Region-scoped even though `business_id` alone would already be
    // unambiguous (F2: a business belongs to exactly one region) — matching
    // the same defensive double-key every other cross-schema query in this
    // codebase uses rather than trusting the join to be enough on its own.
    const followers = await client.query<{
      user_id: string;
      date_of_birth: string | null;
      timezone: string | null;
    }>(
      `SELECT f.user_id, p.date_of_birth, p.timezone
         FROM me.follow f
         LEFT JOIN identity.user_profile p ON p.user_id = f.user_id
        WHERE f.business_id = $1 AND f.region = $2`,
      [event.businessId, event.region],
    );
    if (followers.rows.length === 0) return;

    // 12.1.b: the audience wall reaches notifications too -- a follower who
    // cannot see an `adult`/`teen`/`parents` campaign must not be told it
    // exists. `audience` defaults to `"all_ages"` when the campaign row is
    // gone by the time this runs (a race with a later unpublish, not a real
    // production path for an event that only fires once a campaign IS
    // live) -- the safe direction for a DEFAULT to fail is "notify", since
    // this is a convenience, not an authorization boundary the way
    // `campaign_view.yaml`'s own wall is.
    const campaignRow = await client.query<{ audience: Audience }>(
      `SELECT audience FROM campaign.campaigns WHERE id = $1`,
      [event.campaignId],
    );
    const audience = campaignRow.rows[0]?.audience ?? "all_ages";
    const now = new Date();
    const audienceReachable = followers.rows.filter((follower) => {
      if (audience === "all_ages") return true;
      // No profile row (a test fixture, or a race with account deletion) --
      // fail closed: cannot prove this follower's ageBand reaches a
      // narrower audience, so they are skipped rather than guessed at.
      if (follower.date_of_birth === null) return false;
      const ageBand = ageBandFrom(ageYearsFrom(follower.date_of_birth, now));
      return reachesAudience(audience, { ageBand });
    });

    // 12.2.b: quiet hours (21:00-07:00 in the FOLLOWER's own profile
    // timezone) silence a teen entirely -- no notification row, no push.
    // No profile/timezone to check means nothing to silence (send).
    const reachable = audienceReachable.filter((follower) => {
      if (follower.date_of_birth === null || follower.timezone === null) return true;
      const ageBand = ageBandFrom(ageYearsFrom(follower.date_of_birth, now));
      return !(ageBand === "teen" && isQuietHours(now, follower.timezone));
    });
    if (reachable.length === 0) return;

    const title = "New from a channel you follow";
    const body = "A business you follow just published a new campaign to watch and earn.";

    for (const follower of reachable) {
      await client.query(
        `INSERT INTO me.notification (user_id, region, category, title, body, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          follower.user_id,
          event.region,
          CATEGORY,
          title,
          body,
          JSON.stringify({ campaignId: event.campaignId, businessId: event.businessId }),
        ],
      );

      // 12.4.b (#8): no row means the DPIA's own default -- off for a teen,
      // on for everyone else (`push-default.ts`'s own header). Re-derives
      // this follower's age band from `identity.user_profile` a second
      // time (the row above already fetched `date_of_birth` for the
      // audience/quiet-hours filters) rather than threading it through --
      // this loop already re-queries `me.notification_preference` per
      // follower, so one more indexed lookup keeps the interface uniform
      // with the other two jobs rather than a special-cased shortcut here.
      if (!(await isPushEnabledFor(client, follower.user_id, CATEGORY, now))) continue;

      await push.send({
        // Per-follower, not per-event: one event fans out to many
        // recipients, and each is its own idempotent send.
        idempotencyKey: `${event.idempotencyKey}:${follower.user_id}`,
        to: follower.user_id,
        region: event.region,
        category: CATEGORY,
        title,
        body,
      });
    }
  },
});
