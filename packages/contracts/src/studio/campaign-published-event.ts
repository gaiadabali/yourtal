import { z } from "zod";
import { regionSchema } from "../region/region";

/**
 * TASKS.md 7.3.f: fired when a campaign transitions to `live` (whichever
 * caller performs that transition — Studio's own submit only reaches
 * `in_review`; taking a campaign the rest of the way to `live` is 9.2's
 * moderation queue, out of this phase's scope, but the transition function
 * both call is the one place this event is emitted from, so it fires either
 * way). `apps/worker/src/jobs/campaign-published-notify.ts` (7.3.g) consumes
 * it to notify a business's followers (`me.follow`).
 */
export const CAMPAIGN_PUBLISHED_QUEUE = "campaign.published";

export const campaignPublishedEventSchema = z.object({
  campaignId: z.uuid(),
  businessId: z.uuid(),
  region: regionSchema,
  /** One event per (campaignId, transition) — a campaign cannot re-publish without first leaving `live`. */
  idempotencyKey: z.string().min(1),
});
export type CampaignPublishedEvent = z.infer<typeof campaignPublishedEventSchema>;
