import type { Pool } from "pg";
import { receiversFor } from "@yourtal/contracts/oidc/event-receivers";
import type { EventReceiver } from "@yourtal/contracts/oidc/event-receivers";
import { SPAMBANK_QUEUES } from "@yourtal/contracts/spambank/events";
import { createAppEventsDriver } from "@yourtal/drivers/app-events";
import type { AppEventsDriver } from "@yourtal/drivers/app-events";
import { describeProblem, resolveDriverMode } from "@yourtal/drivers/driver-mode";
import { defineJob } from "../job";
import { spambankPool } from "../spambank-runtime";
import {
  LEASE_MINUTES,
  deliveryPlan,
  loadSigner,
  minutesToNextAttempt,
} from "./app-event-delivery";
import type { OutboxRow, Signer } from "./app-event-delivery";

/**
 * Spambank's mail events to SnapApp (BUILD.md B8, §5.5), from `spambank.app_event_outbox`: the same signer,
 * driver and receiver registry as `oidc.event_outbox`'s (app-event-delivery.ts), but a table and a job of
 * their own, so a new-mail alert stuck in retry can never hold back an `account-deleted`.
 *
 * - Each row has its own expiry (an alert 15 minutes, a statement offer 24 hours). One past it is marked
 *   failed, never sent late: an alert about mail the person has long since read helps nobody.
 * - Claims one due row at a time with a 2-minute lease (SKIP LOCKED), oldest first, like its sibling.
 * - 202 delivers. A refusal fails at once. Anything else retries after 1, 5, 15 and 30 minutes, then hourly,
 *   and fails when the next try would fall after the expiry.
 * Logs carry the jti, the client and the type, never the token or the sub.
 */

const MAX_PER_RUN = 100;
const RUN_BUDGET_MS = 45_000;

interface SpambankOutboxRow extends OutboxRow {
  readonly expires_at: Date;
}

async function expire(db: Pool, now: Date): Promise<number> {
  const result = await db.query(
    `UPDATE spambank.app_event_outbox SET failed_at = $1, last_error = 'expired'
      WHERE delivered_at IS NULL AND failed_at IS NULL AND expires_at <= $1`,
    [now],
  );
  return result.rowCount ?? 0;
}

async function claim(db: Pool, now: Date): Promise<SpambankOutboxRow | undefined> {
  const { rows } = await db.query<SpambankOutboxRow>(
    `UPDATE spambank.app_event_outbox
        SET next_attempt_at = $1::timestamptz + make_interval(mins => $2), attempts = attempts + 1
      WHERE jti = (
        SELECT jti FROM spambank.app_event_outbox
         WHERE delivered_at IS NULL AND failed_at IS NULL
           AND next_attempt_at <= $1 AND expires_at > $1
         ORDER BY iat, jti
         LIMIT 1
         FOR UPDATE SKIP LOCKED)
      RETURNING jti, client_id, sub, event_type, payload, iat, attempts, expires_at`,
    [now, LEASE_MINUTES],
  );
  return rows[0];
}

export interface SpambankDeliveryDeps {
  readonly driver: AppEventsDriver;
  readonly sign: Signer;
  readonly receivers: readonly EventReceiver[];
  readonly now?: () => Date;
  readonly log?: (message: string) => void;
}

/** One run. Returns how many rows it attempted. */
export async function runSpambankEventDelivery(
  db: Pool,
  deps: SpambankDeliveryDeps,
): Promise<number> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((message: string) => console.error(message));
  const started = Date.now();
  const expired = await expire(db, now());
  if (expired > 0)
    log(`[spambank-event] ${String(expired)} event(s) expired before they were sent`);

  let attempted = 0;
  while (attempted < MAX_PER_RUN && Date.now() - started < RUN_BUDGET_MS) {
    const row = await claim(db, now());
    if (row === undefined) break;
    attempted += 1;
    const tag = `jti=${row.jti} client=${row.client_id} type=${row.event_type}`;
    const receiver = deps.receivers.find((candidate) => candidate.clientId === row.client_id);

    const sent =
      receiver === undefined
        ? undefined
        : await deps.driver.post({ endpoint: receiver.endpoint, token: await deps.sign(row) });

    if (sent?.isOk() === true) {
      await db.query(
        `UPDATE spambank.app_event_outbox SET delivered_at = $2, last_error = NULL WHERE jti = $1`,
        [row.jti, now()],
      );
      continue;
    }
    const failure = sent?.isErr() === true ? sent.error : undefined;
    const detail = failure === undefined ? "no receiver for this client here" : failure.detail;
    const wait = minutesToNextAttempt(row.attempts) - minutesToNextAttempt(row.attempts - 1);
    const nextAt = new Date(now().getTime() + wait * 60_000);
    const giveUp = failure === undefined || failure.kind === "declined" || nextAt >= row.expires_at;
    if (giveUp) {
      await db.query(
        `UPDATE spambank.app_event_outbox SET failed_at = $2, last_error = $3 WHERE jti = $1`,
        [row.jti, now(), detail],
      );
      const event = failure?.kind === "declined" ? "refused" : "undelivered";
      log(`[spambank-event] ${event} ${tag} attempts=${String(row.attempts)}: ${detail}`);
    } else {
      await db.query(
        `UPDATE spambank.app_event_outbox SET next_attempt_at = $2, last_error = $3 WHERE jti = $1`,
        [row.jti, nextAt, detail],
      );
    }
  }
  return attempted;
}

export const job = defineJob({
  queue: SPAMBANK_QUEUES.eventDelivery,
  schedule: "* * * * *",
  async handle(_queued, { config }) {
    const mode = resolveDriverMode("app_events", process.env);
    if (mode.isErr()) throw new Error(describeProblem(mode.error));
    const plan = deliveryPlan(config.appEnv, mode.value);
    if (plan === "hold") {
      // Simulated app events on staging or production: events stay queued, then expire. Nothing to log each
      // minute; the sibling job already says so.
      return;
    }
    await runSpambankEventDelivery(spambankPool(config), {
      driver: createAppEventsDriver(mode.value),
      sign:
        plan === "live"
          ? await loadSigner(config.oidc.jwksPath, config.oidc.issuer)
          : () => Promise.resolve(""),
      receivers: receiversFor(config.appEnv),
    });
  },
});
