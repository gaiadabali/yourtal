import { Pool } from "pg";
import type { Job } from "pg-boss";
import { CAMPAIGN_PUBLISHED_QUEUE } from "@yourtal/contracts/studio/campaign-published-event";
import type { CampaignPublishedEvent } from "@yourtal/contracts/studio/campaign-published-event";
import { createSimulatedPush } from "@yourtal/drivers/push";
import { defineJob } from "../job";
import type { JobContext } from "../job";

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
  pool ??= new Pool({ connectionString: databaseUrl });
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
    const followers = await client.query<{ user_id: string }>(
      `SELECT user_id FROM me.follow WHERE business_id = $1 AND region = $2`,
      [event.businessId, event.region],
    );
    if (followers.rows.length === 0) return;

    const title = "New from a channel you follow";
    const body = "A business you follow just published a new campaign to watch and earn.";

    for (const follower of followers.rows) {
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

      const preference = await client.query<{ push_enabled: boolean }>(
        `SELECT push_enabled FROM me.notification_preference WHERE user_id = $1 AND category = $2`,
        [follower.user_id, CATEGORY],
      );
      // No row means the default (enabled) — see notification.repository.ts's own convention.
      const pushEnabled = preference.rows[0]?.push_enabled ?? true;
      if (!pushEnabled) continue;

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
