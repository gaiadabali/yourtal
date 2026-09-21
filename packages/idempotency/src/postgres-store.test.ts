import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { PostgresIdempotencyStore } from "./postgres-store";
import { REDEMPTION_RETENTION_MS, abandon, begin, complete } from "./idempotency";
import type { BeginRequest } from "./idempotency";

/**
 * YT-0515, against the real Postgres from `pnpm dev:up`.
 *
 * The in-memory store's tests prove the LOGIC. These prove the two things
 * only a database can be asked: that `putIfAbsent` is genuinely atomic under
 * concurrency, and that an expired row is taken over rather than blocking.
 * Neither can be demonstrated in a single-threaded map.
 */

const { Pool } = pg;

/**
 * YT-0558: this was a bare literal with no environment read at all, which
 * means it was immune to the standard sabotage of pointing `DATABASE_URL`
 * (or anything else) at a dead host — the suite would keep connecting to
 * whatever `pnpm dev:up` left running and call that proof. `TEST_DATABASE_URL`
 * read first, literal as the fallback, matches the pattern `apps/api`'s
 * database-backed test files use for the same reason (`vitest.config.ts`
 * there sets `env.DATABASE_URL`, so `TEST_DATABASE_URL` is the name a
 * deliberate break can actually reach) — this package has no such config
 * override, but the fix is the same shape: environment first, config or
 * literal only as the fallback.
 */
const APP_URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgres://yourtal_app:app_local_only@127.0.0.1:26432/yourtal";
const AT = new Date("2026-09-19T10:00:00Z");

let pool: pg.Pool;
let store: PostgresIdempotencyStore;
let counter = 0;

beforeAll(async () => {
  pool = new Pool({ connectionString: APP_URL, max: 8 });
  store = new PostgresIdempotencyStore(pool);
  await pool.query("SELECT 1");
});

afterAll(async () => {
  await pool.query("DELETE FROM platform.idempotency WHERE scope LIKE 'test:%'");
  await pool.end();
});

function request(over: Partial<BeginRequest> = {}): BeginRequest {
  counter += 1;
  return {
    scope: `test:${String(counter)}`,
    key: `key-${String(counter)}-${String(Date.now())}`,
    method: "POST",
    path: "/v1/redemptions",
    rawBody: '{"code":"VCH-1","amount":45000}',
    startedAt: AT,
    retentionMs: REDEMPTION_RETENTION_MS,
    ...over,
  };
}

describe("durability", () => {
  it("survives a new store instance, which the in-memory one could not", async () => {
    const first = request();
    await begin(store, first);
    await complete(store, first.scope, first.key, { status: 201, body: '{"id":"rdm_1"}' });

    // A different instance, as if the retry landed on another process.
    const elsewhere = new PostgresIdempotencyStore(pool);
    expect(await begin(elsewhere, first)).toEqual({
      kind: "replay",
      status: 201,
      body: '{"id":"rdm_1"}',
    });
  });
});

describe("atomicity under concurrency", () => {
  it("lets exactly one of eight simultaneous claims win", async () => {
    // The assertion the whole store exists for. A read-then-write would let
    // several of these through, and each winner would execute the operation.
    const shared = request();
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () => begin(store, { ...shared })),
    );

    const winners = outcomes.filter((outcome) => outcome.kind === "proceed");
    const held = outcomes.filter((outcome) => outcome.kind === "in_progress");

    expect(winners).toHaveLength(1);
    expect(held).toHaveLength(7);
  });

  it("does not let a concurrent loser see a half-written response", async () => {
    const shared = request();
    const [first, second] = await Promise.all([
      begin(store, { ...shared }),
      begin(store, { ...shared }),
    ]);

    // Whichever lost must be told the work is running, never handed an empty
    // replay it would return to a client as a success.
    const loser = first.kind === "proceed" ? second : first;
    expect(loser.kind).toBe("in_progress");
  });
});

describe("expiry", () => {
  it("takes over an expired claim rather than reporting it in progress", async () => {
    // A dead row reporting "in progress" would wedge a legitimate retry until
    // someone noticed. ON CONFLICT DO NOTHING cannot express this; the
    // conditional DO UPDATE can, inside the same atomic statement.
    const first = request();
    await begin(store, first);

    const later = new Date(AT.getTime() + REDEMPTION_RETENTION_MS + 1000);
    expect(await begin(store, { ...first, startedAt: later })).toEqual({ kind: "proceed" });
  });

  it("still replays inside the window", async () => {
    const first = request();
    await begin(store, first);
    await complete(store, first.scope, first.key, { status: 200, body: "{}" });

    const later = new Date(AT.getTime() + REDEMPTION_RETENTION_MS - 60_000);
    expect(await begin(store, { ...first, startedAt: later })).toMatchObject({ kind: "replay" });
  });

  it("prunes only expired rows", async () => {
    const stale = request();
    const fresh = request({ retentionMs: REDEMPTION_RETENTION_MS * 30 });
    await begin(store, stale);
    await begin(store, fresh);

    await store.prune(new Date(AT.getTime() + REDEMPTION_RETENTION_MS + 1000));

    const { rows } = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM platform.idempotency WHERE scope = ANY($1)",
      [[stale.scope, fresh.scope]],
    );
    expect(rows[0]?.count).toBe("1");
  });
});

describe("the same semantics as the in-memory store", () => {
  it("replays a completed response", async () => {
    const first = request();
    await begin(store, first);
    await complete(store, first.scope, first.key, { status: 201, body: '{"id":"a"}' });

    expect(await begin(store, first)).toEqual({ kind: "replay", status: 201, body: '{"id":"a"}' });
  });

  it("reports a fingerprint mismatch", async () => {
    const first = request();
    await begin(store, first);
    await complete(store, first.scope, first.key, { status: 201, body: "{}" });

    expect(await begin(store, { ...first, rawBody: '{"amount":1}' })).toEqual({
      kind: "fingerprint_mismatch",
    });
  });

  it("leaves an abandoned key retryable", async () => {
    const first = request();
    await begin(store, first);
    await abandon(store, first.scope, first.key);

    expect(await begin(store, { ...first, rawBody: '{"fixed":true}' })).toEqual({
      kind: "proceed",
    });
  });

  it("refuses to complete a record nobody claimed", async () => {
    const orphan = request();
    await expect(
      complete(store, orphan.scope, orphan.key, { status: 200, body: "{}" }),
    ).rejects.toThrow(/does not exist/);
  });
});
