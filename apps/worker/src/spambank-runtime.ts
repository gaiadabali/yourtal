import { z } from "zod";
import { SPAMBANK_QUEUES, snapappReceiver } from "@yourtal/contracts/spambank/events";
import { describeProblem, resolveDriverMode } from "@yourtal/drivers/driver-mode";
import { createSpambankDriver } from "@yourtal/drivers/spambank";
import type { SpambankDriver } from "@yourtal/drivers/spambank";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { defineQueue } from "@yourtal/queue/define-queue";
import { parseOwnDomains } from "../../api/src/modules/spambank/classify/domains";
import type { IngestDeps } from "../../api/src/modules/spambank/ingest/ingest-mailbox";
import { createStalwartMailer } from "../../api/src/modules/spambank/autoreply/mailer";
import type { SystemMailer } from "../../api/src/modules/spambank/autoreply/mailer";
import { createAlerter } from "../../api/src/modules/spambank/autoreply/pause";
import type { Alerter } from "../../api/src/modules/spambank/autoreply/pause";
import type { AutoreplyDeps } from "../../api/src/modules/spambank/autoreply/run-autoreply";
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

const appEnvSchema = z.enum(["dev", "staging", "production"]).default("dev");

export function loadSpambankConfig(env: NodeJS.ProcessEnv = process.env): SpambankConfig {
  // The API's context: the same APP_ENV rule for `live` and the same web origin for opt-out links.
  const webOrigin = env["PUBLIC_WEB_ORIGIN"];
  spambankConfig ??= spambankConfigFrom(z.object(spambankEnvShape).parse(env), {
    appEnv: appEnvSchema.parse(env["APP_ENV"]),
    ...(webOrigin === undefined || webOrigin === "" ? {} : { webOrigin }),
  });
  return spambankConfig;
}

let driver: SpambankDriver | undefined;

/** One Stalwart driver per process. A bad `SPAMBANK_DRIVER` stops the job (driver-mode.ts). */
export function spambankDriver(): SpambankDriver {
  if (driver === undefined) {
    const mode = resolveDriverMode("spambank", process.env);
    if (mode.isErr()) throw new Error(describeProblem(mode.error));
    driver = createSpambankDriver(mode.value, process.env);
  }
  return driver;
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
    ingestDeps = {
      pool: spambankPool(config),
      driver: spambankDriver(),
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
  for (const emailId of result.autoreplyEmailIds) {
    await sendAutoreplyJob(boss, { mailboxId, emailId });
  }
  if (result.eventsQueued > 0) await kickEventDelivery(boss);
}

let mailer: SystemMailer | undefined;

/** Sends as `reply@<reply domain>`: the auto-replies and the alerts. */
export function spambankMailer(): SystemMailer {
  mailer ??= createStalwartMailer(spambankDriver(), loadSpambankConfig().replyDomain);
  return mailer;
}

export function spambankAlerter(): Alerter {
  const settings = loadSpambankConfig();
  return createAlerter({
    mailer: spambankMailer(),
    replyDomain: settings.replyDomain,
    to: settings.alertEmails,
  });
}

let autoreplyDeps: AutoreplyDeps | undefined;

/** The deps of `runAutoreply` for this process (BUILD.md F4). */
export function spambankAutoreplyDeps(config: WorkerConfig): AutoreplyDeps {
  if (autoreplyDeps === undefined) {
    const settings = loadSpambankConfig();
    const ingest = spambankIngestDeps(config);
    autoreplyDeps = {
      pool: ingest.pool,
      driver: ingest.driver,
      mailer: spambankMailer(),
      classify: ingest.classify,
      settings: {
        mode: settings.autoreply.mode,
        ...(settings.autoreply.redirectTo === undefined
          ? {}
          : { redirectTo: settings.autoreply.redirectTo }),
        replyDomain: settings.replyDomain,
        ...(settings.optoutKey === undefined ? {} : { optoutKey: settings.optoutKey }),
        publicOrigin: settings.sender.publicOrigin,
        abn: settings.sender.abn,
        contactEmail: settings.sender.contactEmail,
      },
    };
  }
  return autoreplyDeps;
}

/** One `spambank.autoreply` job per message; a second send for the same message within 5 minutes is dropped. */
export async function sendAutoreplyJob(
  boss: PgBoss,
  job: { readonly mailboxId: string; readonly emailId: string },
): Promise<void> {
  await defineQueue(boss, SPAMBANK_QUEUES.autoreply);
  await boss.send(SPAMBANK_QUEUES.autoreply, job, {
    singletonKey: `${job.mailboxId}:${job.emailId}`,
    singletonSeconds: 300,
  });
}
