import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { DATA_DOMAINS } from "@yourtal/consent/dsar";
import { executeDeletion } from "@yourtal/consent/dsar-orchestrator";
import { receiversFor } from "@yourtal/contracts/oidc/event-receivers";
import { APP_URL, OWNER_URL } from "./database-urls";
import { postgresHandlers } from "./dsar-handlers";

/**
 * Group 3.7 Y2: the `connected_apps` deletion domain against real Postgres. The
 * SQL itself is Y1's (dsar-connected-apps.test.ts); this is the handler and its
 * wiring, including production's empty receiver list.
 */
const { Pool } = pg;
let app: pg.Pool;
let owner: pg.Pool;

async function signedInPerson(): Promise<string> {
  const id = randomUUID();
  for (const sector of ["snapapp-staging", "ftr"]) {
    await owner.query(`INSERT INTO oidc.subject (sector, user_id, sub) VALUES ($1, $2, $3)`, [
      sector,
      id,
      `sub-${randomUUID()}`,
    ]);
  }
  await owner.query(
    `INSERT INTO oidc.sign_in_log (user_id, client_id, result) VALUES ($1, 'x', 'ok')`,
    [id],
  );
  return id;
}

async function leftOver(userId: string): Promise<{ oidc: number; events: number }> {
  const { rows } = await app.query<{ oidc: number; events: number }>(
    `SELECT ((SELECT count(*) FROM oidc.subject WHERE user_id = $1)
           + (SELECT count(*) FROM oidc.sign_in_log WHERE user_id = $1))::int AS oidc,
            (SELECT count(*) FROM oidc.event_outbox o JOIN oidc.subject s ON s.sub = o.sub
              WHERE s.user_id = $1)::int AS events`,
    [userId],
  );
  return rows[0]!;
}

const eventCount = async (subs: string[]): Promise<number> =>
  (await app.query(`SELECT 1 FROM oidc.event_outbox WHERE sub = ANY($1)`, [subs])).rowCount ?? 0;

async function subsOf(userId: string): Promise<string[]> {
  const { rows } = await app.query<{ sub: string }>(
    `SELECT sub FROM oidc.subject WHERE user_id = $1`,
    [userId],
  );
  return rows.map((row) => row.sub);
}

beforeAll(() => {
  app = new Pool({ connectionString: APP_URL, max: 2 });
  owner = new Pool({ connectionString: OWNER_URL, max: 2 });
});

afterAll(async () => {
  await app.end();
  await owner.end();
});

describe("the connected_apps domain", () => {
  it("is an erase domain owned by ops, and stays unhandled until the caller names its receivers", () => {
    expect(DATA_DOMAINS.find((domain) => domain.id === "connected_apps")).toMatchObject({
      onDeletion: "erase",
      owner: "ops",
      service: "oidc",
    });
    expect(postgresHandlers(app)["connected_apps"]).toBeUndefined();
  });

  it("writes one account-deleted row per app and erases the person's oidc rows", async () => {
    const person = await signedInPerson();
    const subs = await subsOf(person);
    const report = await executeDeletion(
      person,
      {
        connected_apps: postgresHandlers(app, { receivers: receiversFor("staging") })[
          "connected_apps"
        ]!,
      },
      DATA_DOMAINS.filter((domain) => domain.id === "connected_apps"),
    );
    expect(report.complete).toBe(true);
    expect(report.results[0]?.outcome).toEqual({ status: "erased", records: 5 });
    expect(await eventCount(subs)).toBe(2);
    expect((await leftOver(person)).oidc).toBe(0);
  });

  it("succeeds in production, where there is no receiver: rows erased, nothing queued", async () => {
    expect(receiversFor("production")).toEqual([]);
    const person = await signedInPerson();
    const subs = await subsOf(person);
    const report = await executeDeletion(
      person,
      { connected_apps: postgresHandlers(app, { receivers: [] })["connected_apps"]! },
      DATA_DOMAINS.filter((domain) => domain.id === "connected_apps"),
    );
    expect(report.complete).toBe(true);
    expect(report.results[0]?.outcome).toEqual({ status: "erased", records: 3 });
    expect(await eventCount(subs)).toBe(0);
    expect((await leftOver(person)).oidc).toBe(0);
  });

  it("is a no-op for a person who never signed in to an app", async () => {
    const handler = postgresHandlers(app, { receivers: receiversFor("dev") })["connected_apps"]!;
    expect(await handler(randomUUID())).toBe(0);
  });
});
