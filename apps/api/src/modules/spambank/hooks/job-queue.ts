import { Logger } from "@nestjs/common";
import type { OnApplicationShutdown } from "@nestjs/common";
import type { PgBoss } from "pg-boss";
import { defineQueue } from "@yourtal/queue/define-queue";
import { INGEST_DEBOUNCE_SECONDS, SPAMBANK_QUEUES } from "@yourtal/contracts/spambank/events";
import { createApiQueueClient } from "../../../shared/queue/create-api-queue-client";

/**
 * The jobs the webhook can queue. The worker runs them; the API only sends, so a worker that is down just
 * lets them wait (and the reconcile, when it is back, reads the mail anyway).
 */
export interface SpambankJobQueue {
  /** One read of this mailbox, debounced to one per 2 seconds. */
  ingest(mailboxId: string): Promise<void>;
  /** A read of every active mailbox, for a webhook that could not be mapped to one. */
  reconcile(): Promise<void>;
  /** Mail for the system `reply` account (bounces, complaints, answers): T7's job. */
  replyInbox(): Promise<void>;
}

export const SPAMBANK_JOB_QUEUE = Symbol("SPAMBANK_JOB_QUEUE");

const logger = new Logger("SpambankJobQueue");

/**
 * pg-boss, started on the first send so the API boots (and `/api/health` answers) whether or not the queue
 * tables are reachable at that moment. `defineQueue` runs on every send, as the other publishers do:
 * `boss.send` refuses a queue nothing has created, and this must not depend on the worker starting first.
 */
export class PgBossSpambankJobQueue implements SpambankJobQueue, OnApplicationShutdown {
  private boss: Promise<PgBoss> | undefined;

  constructor(private readonly databaseUrl: string) {}

  private start(): Promise<PgBoss> {
    this.boss ??= (async () => {
      const boss = createApiQueueClient(this.databaseUrl);
      await boss.start();
      return boss;
    })().catch((error: unknown) => {
      this.boss = undefined;
      throw error;
    });
    return this.boss;
  }

  async ingest(mailboxId: string): Promise<void> {
    const boss = await this.start();
    await defineQueue(boss, SPAMBANK_QUEUES.ingest);
    // Throttled per mailbox to one job per 2-second slot and started after the slot ends, so a burst of
    // webhooks is one read that happens after the last of them.
    await boss.send(
      SPAMBANK_QUEUES.ingest,
      { mailboxId },
      {
        singletonKey: mailboxId,
        singletonSeconds: INGEST_DEBOUNCE_SECONDS,
        startAfter: INGEST_DEBOUNCE_SECONDS,
      },
    );
  }

  async reconcile(): Promise<void> {
    const boss = await this.start();
    await defineQueue(boss, SPAMBANK_QUEUES.reconcile);
    await boss.send(SPAMBANK_QUEUES.reconcile, {}, { singletonKey: "all", singletonSeconds: 5 });
  }

  async replyInbox(): Promise<void> {
    const boss = await this.start();
    await defineQueue(boss, SPAMBANK_QUEUES.replyInbox);
    await boss.send(
      SPAMBANK_QUEUES.replyInbox,
      {},
      {
        singletonKey: "reply",
        singletonSeconds: INGEST_DEBOUNCE_SECONDS,
        startAfter: INGEST_DEBOUNCE_SECONDS,
      },
    );
  }

  async onApplicationShutdown(): Promise<void> {
    const started = this.boss;
    if (started === undefined) return;
    try {
      await (await started).stop({ graceful: false, timeout: 5000 });
    } catch (error) {
      logger.warn(`pg-boss did not stop cleanly: ${error instanceof Error ? error.message : "?"}`);
    }
  }
}
