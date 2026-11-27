import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { err, ok } from "neverthrow";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { EventReceiver } from "@yourtal/contracts/oidc/event-receivers";
import { SPAMBANK_QUEUES } from "@yourtal/contracts/spambank/events";
import type { AppEventsDriver } from "@yourtal/drivers/app-events";
import { failureFor } from "@yourtal/drivers/fault-engine";
import { loadJobs } from "../job-loader";
import { runSpambankEventDelivery } from "./spambank-app-event-delivery";

/**
 * Spambank's mail events to SnapApp (BUILD.md B8, T6 done-when 4 and 5): real Postgres, a scripted receiver.
 * The signer and driver are the existing ones from app-event-delivery.ts; what is new is the table, the
 * per-row expiry and that nothing here touches `oidc.event_outbox`.
 */

const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (DATABASE_URL === undefined) throw new Error("DATABASE_URL/TEST_DATABASE_URL must be set");
const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });

const RUN = randomUUID().slice(0, 8);
const CLIENT = `sbt6-client-${RUN}`;
const RECEIVER: EventReceiver = {
  sector: "s",
  clientId: CLIENT,
  endpoint: "https://receiver.test/events",
  environments: ["dev", "staging"],
};
const MAIL = "urn:yourtal:event:spambank-mail";

beforeAll(async () => {
  await pool.query("DELETE FROM spambank.app_event_outbox WHERE client_id = $1", [CLIENT]);
});
afterEach(async () => {
  await pool.query("DELETE FROM spambank.app_event_outbox WHERE client_id = $1", [CLIENT]);
});
afterAll(async () => {
  await pool.end();
});

async function queue(over: { ttlMinutes?: number; sub?: string } = {}): Promise<string> {
  const jti = randomUUID();
  await pool.query(
    `INSERT INTO spambank.app_event_outbox (jti, client_id, sub, event_type, payload, iat, expires_at, next_attempt_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, now(), now() + make_interval(mins => $6),
             now() - interval '1 second')`,
    [
      jti,
      CLIENT,
      over.sub ?? `sub-${RUN}`,
      MAIL,
      JSON.stringify({ [MAIL]: { unread_inbox: 2 } }),
      over.ttlMinutes ?? 15,
    ],
  );
  return jti;
}

async function row(jti: string) {
  const { rows } = await pool.query<{
    delivered_at: Date | null;
    failed_at: Date | null;
    attempts: number;
    last_error: string | null;
    next_attempt_at: Date;
  }>(
    "SELECT delivered_at, failed_at, attempts, last_error, next_attempt_at FROM spambank.app_event_outbox WHERE jti = $1",
    [jti],
  );
  return rows[0];
}

function driver(answers: ("ok" | "declined" | "server_error")[]): {
  driver: AppEventsDriver;
  posts: { endpoint: string; token: string }[];
} {
  const posts: { endpoint: string; token: string }[] = [];
  return {
    posts,
    driver: {
      mode: "live",
      post(event) {
        posts.push(event);
        const answer = answers.shift() ?? "ok";
        return Promise.resolve(
          answer === "ok"
            ? ok({ status: 202 as const })
            : err({
                ...failureFor("app_events", answer === "declined" ? "decline" : "server_error"),
                detail: answer,
              }),
        );
      },
    },
  };
}

const sign = (row: { jti: string; event_type: string }) => Promise.resolve(`token-for-${row.jti}`);
const deps = (d: AppEventsDriver, now?: () => Date) => ({
  driver: d,
  sign,
  receivers: [RECEIVER],
  log: () => undefined,
  ...(now === undefined ? {} : { now }),
});

describe("runSpambankEventDelivery", () => {
  it("signs and posts a due event, and marks it delivered on 202", async () => {
    const jti = await queue();
    const { driver: d, posts } = driver(["ok"]);
    expect(await runSpambankEventDelivery(pool, deps(d))).toBeGreaterThanOrEqual(1);
    expect(posts.map((p) => p.endpoint)).toContain(RECEIVER.endpoint);
    expect(posts.some((p) => p.token === `token-for-${jti}`)).toBe(true);
    expect((await row(jti))?.delivered_at).toBeInstanceOf(Date);
  });

  it("a refusal fails it at once", async () => {
    const jti = await queue();
    await runSpambankEventDelivery(pool, deps(driver(["declined"]).driver));
    const after = await row(jti);
    expect(after?.failed_at).toBeInstanceOf(Date);
    expect(after?.delivered_at).toBeNull();
  });

  it("a server error retries after a minute, and the row is not sent again before then", async () => {
    const jti = await queue();
    const first = driver(["server_error"]);
    await runSpambankEventDelivery(pool, deps(first.driver));
    const after = await row(jti);
    expect(after).toMatchObject({ attempts: 1, delivered_at: null, failed_at: null });
    expect(after?.next_attempt_at.getTime()).toBeGreaterThan(Date.now());
    const again = driver(["ok"]);
    await runSpambankEventDelivery(pool, deps(again.driver));
    expect(again.posts.some((p) => p.token === `token-for-${jti}`)).toBe(false);
    // A minute and a bit later it goes.
    await runSpambankEventDelivery(
      pool,
      deps(again.driver, () => new Date(Date.now() + 90_000)),
    );
    expect((await row(jti))?.delivered_at).toBeInstanceOf(Date);
  });

  it("an event past its expiry is failed, never sent late", async () => {
    const jti = await queue({ ttlMinutes: -5 });
    const { driver: d, posts } = driver(["ok"]);
    await runSpambankEventDelivery(pool, deps(d));
    expect(posts.some((p) => p.token === `token-for-${jti}`)).toBe(false);
    expect(await row(jti)).toMatchObject({ failed_at: expect.any(Date), last_error: "expired" });
  });

  it("gives up when the next retry would fall after the expiry", async () => {
    const jti = await queue({ ttlMinutes: 1 });
    await runSpambankEventDelivery(pool, deps(driver(["server_error"]).driver));
    expect((await row(jti))?.failed_at).toBeInstanceOf(Date);
  });

  it("a client with no receiver here is failed, not retried", async () => {
    const jti = await queue();
    const { driver: d, posts } = driver(["ok"]);
    await runSpambankEventDelivery(pool, { ...deps(d), receivers: [] });
    expect(posts).toHaveLength(0);
    expect((await row(jti))?.failed_at).toBeInstanceOf(Date);
  });

  it("does not touch oidc.event_outbox", async () => {
    const before = await pool.query("SELECT count(*) FROM oidc.event_outbox");
    await queue();
    await runSpambankEventDelivery(pool, deps(driver(["ok"]).driver));
    const after = await pool.query("SELECT count(*) FROM oidc.event_outbox");
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});

describe("the Spambank jobs", () => {
  it("load with their queues and schedules, and name the queues T7 sends to", async () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const loaded = await loadJobs(dir);
    const byQueue = new Map(loaded.map((l) => [l.job.queue, l.job]));
    expect(byQueue.get(SPAMBANK_QUEUES.ingest)?.schedule).toBeUndefined();
    expect(byQueue.get(SPAMBANK_QUEUES.reconcile)?.schedule).toBe("* * * * *");
    expect(byQueue.get(SPAMBANK_QUEUES.eventDelivery)?.schedule).toBe("* * * * *");
    expect(byQueue.get(SPAMBANK_QUEUES.purge)?.schedule).toBeDefined();
    // The other file's job still loads next to ours.
    expect(byQueue.has("oidc.app_event_delivery")).toBe(true);
  });
});
