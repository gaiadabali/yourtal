import type { PgBoss } from "pg-boss";
import { defineQueue } from "@yourtal/queue/define-queue";
import { sendIdempotent } from "@yourtal/queue/send-idempotent";
import {
  CAMPAIGN_PUBLISHED_QUEUE,
  campaignPublishedEventSchema,
} from "@yourtal/contracts/studio/campaign-published-event";
import type { CampaignPublishedEvent } from "@yourtal/contracts/studio/campaign-published-event";

/**
 * TASKS.md 7.3.f's producer half — `apps/worker/src/jobs/campaign-published-
 * notify.ts` (7.3.g) is the consumer. `defineQueue` runs on every publish
 * (idempotent — `dev-clock.service.ts`'s own comment on why: `boss.send`
 * refuses a queue nothing has ever created, and this must not depend on
 * the worker process having started first).
 */
export interface CampaignPublishedPublisher {
  publish(event: CampaignPublishedEvent): Promise<void>;
}

export const CAMPAIGN_PUBLISHED_PUBLISHER = Symbol("CAMPAIGN_PUBLISHED_PUBLISHER");

export class PgBossCampaignPublishedPublisher implements CampaignPublishedPublisher {
  constructor(private readonly boss: PgBoss) {}

  async publish(event: CampaignPublishedEvent): Promise<void> {
    const parsed = campaignPublishedEventSchema.parse(event);
    await defineQueue(this.boss, CAMPAIGN_PUBLISHED_QUEUE);
    await sendIdempotent(this.boss, CAMPAIGN_PUBLISHED_QUEUE, parsed);
  }
}
