import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { SignJWT, importJWK } from "jose";
import { receiversFor } from "@yourtal/contracts/oidc/event-receivers";
import type { EventReceiver } from "@yourtal/contracts/oidc/event-receivers";
import { createAppEventsDriver } from "@yourtal/drivers/app-events";
import type { AppEventsDriver } from "@yourtal/drivers/app-events";
import { describeProblem, resolveDriverMode } from "@yourtal/drivers/driver-mode";
import { createPool } from "../pool";
import { defineJob } from "../job";

/**
 * Group 3.7 Y4 (docs/29 §4.2, docs/26 §2.3-2.4): signs each `oidc.event_outbox` row as a
 * Security Event Token and posts it to the app through the `app_events` driver.
 *
 * - Claims one due row at a time with a 2-minute lease on `next_attempt_at` (SKIP LOCKED), so two
 *   runs never send the same row; a send takes at most 10 s, well inside the lease.
 * - Oldest `iat` first; a row waits while an earlier one for the same client and `sub` is neither
 *   delivered nor failed (D4: a failed one no longer holds the rest back).
 * - 202 delivers. A refusal (400, any `err` but `invalid_key`) fails at once. Anything else retries
 *   after 1, 5, 15 and 30 minutes, then hourly, and fails once the next try would be past 7 days.
 * Logs carry the jti, the client and the event type, never the token or the sub.
 */

export const LEASE_MINUTES = 2;
const BACKOFF_MINUTES = [1, 5, 15, 30];
const GIVE_UP_MINUTES = 7 * 24 * 60;
const MAX_PER_RUN = 100;
const RUN_BUDGET_MS = 45_000;

/** Minutes from the first attempt to the one after attempt `attempts` (1-based). */
export function minutesToNextAttempt(attempts: number): number {
  const early = BACKOFF_MINUTES.slice(0, attempts).reduce((sum, minutes) => sum + minutes, 0);
  return early + 60 * Math.max(0, attempts - BACKOFF_MINUTES.length);
}

export interface OutboxRow {
  readonly jti: string;
  readonly client_id: string;
  readonly sub: string;
  readonly event_type: string;
  readonly payload: Record<string, unknown>;
  readonly iat: Date;
  readonly attempts: number;
}

export type Signer = (row: OutboxRow) => Promise<string>;

/** Signs with the first key in the API's JWKS file (scripts/oidc-keys.mjs: the first key signs). */
export async function loadSigner(jwksPath: string, issuer: string): Promise<Signer> {
  let jwk: Record<string, unknown> | undefined;
  try {
    const parsed = JSON.parse(await readFile(jwksPath, "utf8")) as { keys?: unknown };
    jwk = Array.isArray(parsed.keys) ? (parsed.keys[0] as Record<string, unknown>) : undefined;
  } catch {
    // JSON.parse's message quotes the file near the fault, which is key material.
    throw new Error(`app-event: cannot read the signing keys at ${jwksPath}`);
  }
  const kid = jwk?.["kid"];
  if (jwk?.["kty"] !== "RSA" || typeof kid !== "string" || typeof jwk["d"] !== "string") {
    throw new Error(`app-event: the first key in ${jwksPath} is not an RSA private key with a kid`);
  }
  const key = await importJWK({ ...jwk, alg: "RS256" }, "RS256");
  return (row) =>
    new SignJWT({
      iss: issuer,
      aud: row.client_id,
      iat: Math.floor(row.iat.getTime() / 1000),
      jti: row.jti,
      sub_id: { format: "iss_sub", iss: issuer, sub: row.sub },
      events: row.payload,
    })
      .setProtectedHeader({ alg: "RS256", typ: "secevent+jwt", kid })
      .sign(key);
}

async function claim(db: Pool, now: Date): Promise<OutboxRow | undefined> {
  const { rows } = await db.query<OutboxRow>(
    `UPDATE oidc.event_outbox
        SET next_attempt_at = $1::timestamptz + make_interval(mins => $2), attempts = attempts + 1
      WHERE jti = (
        SELECT e.jti FROM oidc.event_outbox e
         WHERE e.delivered_at IS NULL AND e.failed_at IS NULL AND e.next_attempt_at <= $1
           AND NOT EXISTS (
             SELECT 1 FROM oidc.event_outbox p
              WHERE p.client_id = e.client_id AND p.sub = e.sub
                AND p.delivered_at IS NULL AND p.failed_at IS NULL
                AND (p.iat, p.jti) < (e.iat, e.jti))
         ORDER BY e.iat, e.jti
         LIMIT 1
         FOR UPDATE SKIP LOCKED)
      RETURNING jti, client_id, sub, event_type, payload, iat, attempts`,
    [now, LEASE_MINUTES],
  );
  return rows[0];
}

export interface DeliveryDeps {
  readonly driver: AppEventsDriver;
  readonly sign: Signer;
  readonly receivers: readonly EventReceiver[];
  readonly now?: () => Date;
  readonly log?: (message: string) => void;
}

/** One run. Returns how many rows it attempted. */
export async function runAppEventDelivery(db: Pool, deps: DeliveryDeps): Promise<number> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((message: string) => console.error(message));
  const started = Date.now();
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
        `UPDATE oidc.event_outbox SET delivered_at = $2, last_error = NULL WHERE jti = $1`,
        [row.jti, now()],
      );
      continue;
    }
    const failure = sent?.isErr() === true ? sent.error : undefined;
    const detail = failure === undefined ? "no receiver for this client here" : failure.detail;
    const giveUp =
      failure === undefined ||
      failure.kind === "declined" ||
      minutesToNextAttempt(row.attempts) > GIVE_UP_MINUTES;
    if (giveUp) {
      await db.query(
        `UPDATE oidc.event_outbox SET failed_at = $2, last_error = $3 WHERE jti = $1`,
        [row.jti, now(), detail],
      );
      const event = failure?.kind === "declined" ? "app_event.refused" : "app_event.undelivered";
      log(`[app-event] ${event} ${tag} attempts=${String(row.attempts)}: ${detail}`);
    } else {
      const wait = minutesToNextAttempt(row.attempts) - minutesToNextAttempt(row.attempts - 1);
      await db.query(
        `UPDATE oidc.event_outbox
            SET next_attempt_at = $2::timestamptz + make_interval(mins => $3), last_error = $4
          WHERE jti = $1`,
        [row.jti, now(), wait, detail],
      );
    }
  }
  return attempted;
}

let pool: Pool | undefined;

export const job = defineJob({
  queue: "oidc.app_event_delivery",
  schedule: "* * * * *",
  async handle(_job, { config }) {
    pool ??= createPool(config.databaseUrl);
    const mode = resolveDriverMode("app_events", process.env);
    // Never a silent fallback to the simulator (driver-mode.ts): a bad setting stops the job.
    if (mode.isErr()) throw new Error(describeProblem(mode.error));
    const live = mode.value === "live";
    await runAppEventDelivery(pool, {
      driver: createAppEventsDriver(mode.value),
      // Read every run, so a key rotation needs no worker restart. Simulated sends nothing.
      sign: live
        ? await loadSigner(config.oidc.jwksPath, config.oidc.issuer)
        : () => Promise.resolve(""),
      receivers: receiversFor(config.appEnv),
    });
  },
});
