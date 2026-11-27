import { z } from "zod";
import { SPAMBANK_QUEUES, snapappReceiver } from "@yourtal/contracts/spambank/events";
import { describeProblem, resolveDriverMode } from "@yourtal/drivers/driver-mode";
import { createSpambankDriver } from "@yourtal/drivers/spambank";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { defineQueue } from "@yourtal/queue/define-queue";
import { parseOwnDomains } from "../../api/src/modules/spambank/classify/domains";
import type { IngestDeps } from "../../api/src/modules/spambank/ingest/ingest-mailbox";
import { spambankConfigFrom, spambankEnvShape } from "../../api/src/config/spambank-config";
import type { SpambankConfig } from "../../api/src/config/spambank-config";
import type { WorkerConfig } from "./config";
import { createPool } from "./pool";

/**
 * What every Spambank worker job shares: the pool, the Stalwart driver and the classification settings,
 * built once per process.
 *
 * The worker imports Spambank's ingest from `apps/api` (BUILD.md T6 owns it there): it is plain functions
 * over `pg`, with no Nest, no decorators and no request, so it bundles into the worker as it is. The
 * settings are parsed with the API's own schema, so a variable means the same thing in both processes.
 */
let spambankConfig: SpambankConfig | undefined;

export function loadSpambankConfig(env: NodeJS.ProcessEnv = process.env): SpambankConfig {
  spambankConfig ??= spambankConfigFrom(z.object(spambankEnvShape).parse(env));
  return spambankConfig;
}

let pool: Pool | undefined;

export function spambankPool(config: WorkerConfig): Pool {
  pool ??= createPool(config.databaseUrl);
  return pool;
}

let ingestDeps: IngestDeps | undefined;

/** The deps of `ingestMailbox`/`reconcileMailboxes` for this process. */
export function spambankIngestDeps(config: WorkerConfig): IngestDeps {
  if (ingestDeps === undefined) {
    const settings = loadSpambankConfig();
    const mode = resolveDriverMode("spambank", process.env);
    // Never a silent fallback to the simulator: a bad setting stops the job (driver-mode.ts).
    if (mode.isErr()) throw new Error(describeProblem(mode.error));
    ingestDeps = {
      pool: spambankPool(config),
      driver: createSpambankDriver(mode.value, process.env),
      classify: {
        authservId: settings.authservId,
        ownOrgDomains: parseOwnDomains(settings.ownDomains.join(",")),
      },
      autoreplyMode: settings.autoreply.mode,
      receiver: snapappReceiver(config.appEnv),
    };
  }
  return ingestDeps;
}

/** BUILD.md 4.9: mail events are sent as soon as they are queued; the cron only retries. */
export async function kickEventDelivery(boss: PgBoss): Promise<void> {
  await defineQueue(boss, SPAMBANK_QUEUES.eventDelivery);
  await boss.send(SPAMBANK_QUEUES.eventDelivery, {});
}

/**
 * After an ingest run: one `spambank.autoreply` job per message the classifier let through (T7 decides and
 * sends; ingest only names them), and a kick to the delivery job when events were queued.
 */
export async function afterIngest(
  boss: PgBoss,
  mailboxId: string,
  result: { autoreplyEmailIds: readonly string[]; eventsQueued: number },
): Promise<void> {
  if (result.autoreplyEmailIds.length > 0) {
    await defineQueue(boss, SPAMBANK_QUEUES.autoreply);
    for (const emailId of result.autoreplyEmailIds) {
      await boss.send(SPAMBANK_QUEUES.autoreply, { mailboxId, emailId });
    }
  }
  if (result.eventsQueued > 0) await kickEventDelivery(boss);
}
