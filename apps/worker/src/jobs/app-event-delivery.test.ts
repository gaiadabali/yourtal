import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import {
  createLocalJWKSet,
  decodeProtectedHeader,
  errors,
  exportJWK,
  generateKeyPair,
  jwtVerify,
} from "jose";
import type { JSONWebKeySet } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { EventReceiver } from "@yourtal/contracts/oidc/event-receivers";
import { createLiveAppEvents, createSimulatedAppEvents } from "@yourtal/drivers/app-events";
import { loadSigner, minutesToNextAttempt, runAppEventDelivery } from "./app-event-delivery";
import type { DeliveryDeps, Signer } from "./app-event-delivery";
import { purgeDeliveredEvents, sweepOrphanSubjects } from "./app-event-sweep";

/** Real Postgres, and a local receiver that verifies the SET claim for claim like SnapApp's and FTR's. */
const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (DATABASE_URL === undefined) throw new Error("DATABASE_URL/TEST_DATABASE_URL must be set");
const pool = new Pool({ connectionString: DATABASE_URL, max: 6 });

const ISSUER = "https://yourtal.test/oidc";
const DELETED = "urn:yourtal:event:account-deleted";
const ENDED = "urn:yourtal:event:access-ended";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let server: Server;
let endpoint: string;
let jwks: JSONWebKeySet;
let sign: Signer;
let answer: (
  set: Received,
) => { status: number; body?: string } | Promise<{ status: number; body?: string }>;
const received: Received[] = [];

interface Received {
  readonly kid: string | undefined;
  readonly payload: Record<string, unknown>;
}

/** jwtVerify with the receivers' exact options, then their own claim checks (events-verify.ts, yourtal-events.ts). */
async function verifyLikeTheApps(token: string, clientId: string): Promise<Received | string> {
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, createLocalJWKSet(jwks), {
      issuer: ISSUER,
      audience: clientId,
      typ: "secevent+jwt",
      algorithms: ["RS256"],
    }));
  } catch (error) {
    return error instanceof errors.JWKSNoMatchingKey ? "invalid_key" : "authentication_failed";
  }
  const now = Date.now() / 1000;
  const { aud, iat, jti, sub_id: sid, events } = payload;
  if (aud !== clientId) return "invalid_audience"; // a string, not an array
  if (typeof iat !== "number" || iat > now + 300 || iat < now - 30 * 86_400)
    return "invalid_request";
  if (typeof jti !== "string" || !UUID.test(jti)) return "invalid_request";
  const subId = sid as { format?: unknown; iss?: unknown; sub?: unknown } | undefined;
  if (subId?.format !== "iss_sub" || typeof subId.sub !== "string" || subId.sub === "")
    return "invalid_request";
  if (subId.iss !== ISSUER) return "invalid_issuer";
  const types = typeof events === "object" && events !== null ? Object.keys(events) : [];
  const body = types.length === 1 ? (events as Record<string, unknown>)[types[0] ?? ""] : null;
  if (typeof body !== "object" || body === null || Array.isArray(body)) return "invalid_request";
  return { kid: decodeProtectedHeader(token).kid, payload };
}

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const kid = "test-key-1";
  jwks = { keys: [{ ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" }] };
  const dir = mkdtempSync(path.join(tmpdir(), "app-events-"));
  const file = path.join(dir, "jwks.json");
  writeFileSync(file, JSON.stringify({ keys: [{ ...(await exportJWK(privateKey)), kid }] }));
  sign = await loadSigner(file, ISSUER);

  server = createServer((request, response) => {
    let token = "";
    request.on("data", (chunk: Buffer) => (token += chunk.toString()));
    request.on("end", () => {
      void (async () => {
        const client = request.url?.slice(1) ?? "";
        const typeOk = request.headers["content-type"] === "application/secevent+jwt";
        const verified = typeOk ? await verifyLikeTheApps(token, client) : "invalid_request";
        if (typeof verified === "string") {
          response
            .writeHead(400, { "content-type": "application/json" })
            .end(JSON.stringify({ err: verified }));
          return;
        }
        received.push(verified);
        const reply = await answer(verified);
        response.writeHead(reply.status).end(reply.body ?? "");
      })();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

// Rows are due on a clock far in the past, so a run here never touches another test's rows.
let clock: Date;
let client: string;
const logs: string[] = [];
beforeEach(() => {
  clock = new Date(Date.UTC(2001, 0, 1) + Math.floor(Math.random() * 1e9) * 1000);
  client = `client-${randomUUID()}`;
  received.length = 0;
  logs.length = 0;
  answer = () => ({ status: 202 });
});

const receivers = (): EventReceiver[] => [
  {
    sector: `sector-${client}`,
    clientId: client,
    endpoint: `${endpoint}/${client}`,
    environments: ["dev"],
  },
];

function deps(overrides: Partial<DeliveryDeps> = {}): DeliveryDeps {
  return {
    driver: createLiveAppEvents({ endpoints: [`${endpoint}/${client}`], timeoutMs: 500 }),
    sign,
    receivers: receivers(),
    now: () => clock,
    log: (message) => logs.push(message),
    ...overrides,
  };
}

async function row(
  sub = "sub-1",
  iat = new Date(),
  event = DELETED,
  attempts = 0,
): Promise<string> {
  const jti = randomUUID();
  const body = event === DELETED ? {} : { reason: "user_removed", erase_data: false };
  await pool.query(
    `INSERT INTO oidc.event_outbox (jti, client_id, sub, event_type, payload, iat, attempts, next_attempt_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [jti, client, sub, event, { [event]: body }, iat, attempts, clock],
  );
  return jti;
}

interface State {
  attempts: number;
  next_attempt_at: Date;
  delivered_at: Date | null;
  failed_at: Date | null;
  last_error: string | null;
}
async function state(jti: string): Promise<State> {
  const { rows } = await pool.query<State>(
    `SELECT attempts, next_attempt_at, delivered_at, failed_at, last_error FROM oidc.event_outbox WHERE jti = $1`,
    [jti],
  );
  if (rows[0] === undefined) throw new Error(`no row ${jti}`);
  return rows[0];
}
const later = (minutes: number) => new Date(clock.getTime() + minutes * 60_000);

describe("app-event-delivery (3.7 Y4)", () => {
  it("posts a SET the apps verify: typ, RS256, kid, iss, a string aud, jti, iat, sub_id, one event", async () => {
    const iat = new Date(Date.now() - 60_000);
    const deleted = await row("sub-d", iat);
    const ended = await row("sub-e", iat, ENDED);
    expect(await runAppEventDelivery(pool, deps())).toBe(2);

    expect(received.map((r) => r.payload["jti"]).sort()).toStrictEqual([deleted, ended].sort());
    const first = received.find((r) => r.payload["jti"] === deleted);
    expect(first?.kid).toBe("test-key-1");
    expect(first?.payload).toStrictEqual({
      iss: ISSUER,
      aud: client,
      iat: Math.floor(iat.getTime() / 1000),
      jti: deleted,
      sub_id: { format: "iss_sub", iss: ISSUER, sub: "sub-d" },
      events: { [DELETED]: {} },
    });
    expect(received.find((r) => r.payload["jti"] === ended)?.payload["events"]).toStrictEqual({
      [ENDED]: { reason: "user_removed", erase_data: false },
    });
    expect((await state(deleted)).delivered_at).toStrictEqual(clock);
  });

  it.each([
    ["400 invalid_key", 400, '{"err":"invalid_key"}'],
    ["429", 429, ""],
    ["500", 500, ""],
    ["503", 503, ""],
    ["another 2xx", 200, ""],
  ])("retries after 1 minute on %s", async (_name, status, body) => {
    answer = () => ({ status, body });
    const jti = await row();
    await runAppEventDelivery(pool, deps());
    expect(await state(jti)).toMatchObject({
      attempts: 1,
      next_attempt_at: later(1),
      delivered_at: null,
      failed_at: null,
    });
    expect(logs).toStrictEqual([]);
  });

  it("retries a timeout", async () => {
    answer = () => new Promise((resolve) => setTimeout(() => resolve({ status: 202 }), 1500));
    const jti = await row();
    await runAppEventDelivery(pool, deps());
    expect(await state(jti)).toMatchObject({
      attempts: 1,
      next_attempt_at: later(1),
      failed_at: null,
    });
  });

  it.each([
    ["invalid_audience", '{"err":"invalid_audience"}'],
    ["a 400 with no err", "not json"],
  ])("fails at once on a 400 with %s, and logs app_event.refused", async (_name, body) => {
    answer = () => ({ status: 400, body });
    const jti = await row();
    await runAppEventDelivery(pool, deps());
    expect(await state(jti)).toMatchObject({ attempts: 1, failed_at: clock, delivered_at: null });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("app_event.refused");
    expect(logs[0]).toContain(jti);
  });

  it("fails a token the app refuses for real (signed for another audience)", async () => {
    const jti = await row();
    const wrong: Signer = async (r) => sign({ ...r, client_id: "someone-else" });
    await runAppEventDelivery(pool, deps({ sign: wrong }));
    expect((await state(jti)).last_error).toBe("400 invalid_audience");
  });

  it("backs off 1, 5, 15, 30 minutes, then hourly, and gives up after 7 days", async () => {
    expect([1, 2, 3, 4, 5, 6].map(minutesToNextAttempt)).toStrictEqual([1, 6, 21, 51, 111, 171]);
    answer = () => ({ status: 503 });
    const jti = await row();
    for (const wait of [1, 5, 15, 30, 60]) {
      const before = clock;
      await runAppEventDelivery(pool, deps());
      expect((await state(jti)).next_attempt_at).toStrictEqual(
        new Date(before.getTime() + wait * 60_000),
      );
      clock = new Date(before.getTime() + wait * 60_000);
    }
    const lastHourly = await row("sub-2", new Date(), DELETED, 170);
    const pastSevenDays = await row("sub-3", new Date(), DELETED, 171);
    await runAppEventDelivery(pool, deps());
    expect(await state(lastHourly)).toMatchObject({ failed_at: null, next_attempt_at: later(60) });
    expect(await state(pastSevenDays)).toMatchObject({ failed_at: clock, attempts: 172 });
    expect(logs.filter((line) => line.includes("app_event.undelivered"))).toHaveLength(1);
  });

  it("the lease stops double sends: two runs at once send each row once", async () => {
    answer = () => new Promise((resolve) => setTimeout(() => resolve({ status: 202 }), 50));
    const jtis = await Promise.all(["a", "b", "c", "d", "e", "f"].map((sub) => row(sub)));
    const [one, two] = await Promise.all([
      runAppEventDelivery(pool, deps()),
      runAppEventDelivery(pool, deps()),
    ]);
    expect(one + two).toBe(6);
    expect(received.map((r) => r.payload["jti"]).sort()).toStrictEqual([...jtis].sort());
  });

  it("a leased row is not taken again for 2 minutes", async () => {
    const jti = await row();
    await pool.query(
      `UPDATE oidc.event_outbox SET next_attempt_at = $2::timestamptz + interval '2 minutes' WHERE jti = $1`,
      [jti, clock],
    );
    clock = later(1);
    expect(await runAppEventDelivery(pool, deps())).toBe(0);
    clock = later(1);
    expect(await runAppEventDelivery(pool, deps())).toBe(1);
  });

  it("keeps the order for one client and sub, while another sub goes ahead", async () => {
    let refuseFirst = true;
    answer = () => (refuseFirst ? ((refuseFirst = false), { status: 503 }) : { status: 202 });
    const older = await row("sub-o", new Date(Date.now() - 2000), ENDED);
    const newer = await row("sub-o", new Date(Date.now() - 1000));
    const other = await row("sub-x", new Date());
    await runAppEventDelivery(pool, deps());
    expect((await state(older)).delivered_at).toBeNull();
    expect((await state(newer)).attempts).toBe(0); // waits behind the retrying one
    expect((await state(other)).delivered_at).not.toBeNull();

    clock = later(1);
    received.length = 0;
    await runAppEventDelivery(pool, deps());
    expect(received.map((r) => r.payload["jti"])).toStrictEqual([older, newer]);
  });

  it("a failed event no longer holds back the later ones (D4)", async () => {
    const refused = { status: 400, body: '{"err":"invalid_request"}' };
    answer = (set) => (ENDED in (set.payload["events"] as object) ? refused : { status: 202 });
    const older = await row("sub-o", new Date(Date.now() - 2000), ENDED);
    const newer = await row("sub-o", new Date(Date.now() - 1000));
    await runAppEventDelivery(pool, deps());
    expect((await state(older)).failed_at).not.toBeNull();
    expect((await state(newer)).delivered_at).not.toBeNull();
  });

  it("fails a row whose client has no receiver here, and never posts to an unregistered address", async () => {
    const orphan = await row();
    await runAppEventDelivery(pool, deps({ receivers: [] }));
    expect(await state(orphan)).toMatchObject({
      failed_at: clock,
      last_error: "no receiver for this client here",
    });

    const stray = await row("sub-2");
    const strayReceivers = [{ ...receivers()[0]!, endpoint: `${endpoint}/elsewhere` }];
    await runAppEventDelivery(pool, deps({ receivers: strayReceivers }));
    expect((await state(stray)).failed_at).toStrictEqual(clock);
    expect(received).toHaveLength(0);
  });

  it("simulated: no call, delivered", async () => {
    const jti = await row();
    await runAppEventDelivery(pool, deps({ driver: createSimulatedAppEvents() }));
    expect((await state(jti)).delivered_at).toStrictEqual(clock);
    expect(received).toHaveLength(0);
  });
});

describe("app-event-sweep (3.7 Y4)", () => {
  it("purges rows delivered more than 30 days ago, and keeps the rest", async () => {
    const old = await row("sub-1");
    const recent = await row("sub-2");
    const pending = await row("sub-3");
    await pool.query(
      `UPDATE oidc.event_outbox SET delivered_at = now() - interval '31 days' WHERE jti = $1`,
      [old],
    );
    await pool.query(
      `UPDATE oidc.event_outbox SET delivered_at = now() - interval '29 days' WHERE jti = $1`,
      [recent],
    );
    expect(await purgeDeliveredEvents(pool)).toBeGreaterThanOrEqual(1);
    const { rows } = await pool.query<{ jti: string }>(
      `SELECT jti FROM oidc.event_outbox WHERE client_id = $1`,
      [client],
    );
    expect(rows.map((r) => r.jti).sort()).toStrictEqual([recent, pending].sort());
  });

  it("tells the apps about a sub whose person is gone, and fails closed with no receivers", async () => {
    const person = randomUUID();
    const sector = receivers()[0]!.sector;
    await pool.query(
      `INSERT INTO oidc.subject (sector, user_id, sub, created_at) VALUES ($1, $2, 'orphan-sub', now() - interval '1 hour')`,
      [sector, person],
    );
    const fresh = randomUUID();
    await pool.query(
      `INSERT INTO oidc.subject (sector, user_id, sub) VALUES ($1, $2, 'fresh-sub')`,
      [sector, fresh],
    );

    // Production has no receivers: the handler refuses, and the subject row stays.
    const closed = await sweepOrphanSubjects(pool, [], (message) => logs.push(message));
    expect(closed.failed).toBeGreaterThanOrEqual(1);
    expect(logs.some((line) => line.includes(person))).toBe(true);

    expect((await sweepOrphanSubjects(pool, receivers())).forgotten).toBeGreaterThanOrEqual(1);
    const left = await pool.query(`SELECT user_id FROM oidc.subject WHERE sector = $1`, [sector]);
    expect(left.rows.map((r: { user_id: string }) => r.user_id)).toStrictEqual([fresh]); // under 10 minutes old

    await pool.query(`UPDATE oidc.event_outbox SET next_attempt_at = $2 WHERE client_id = $1`, [
      client,
      clock,
    ]);
    await runAppEventDelivery(pool, deps());
    expect(received).toHaveLength(1);
    expect(received[0]?.payload["sub_id"]).toMatchObject({ sub: "orphan-sub" });
    expect(received[0]?.payload["events"]).toStrictEqual({ [DELETED]: {} });
  });
});
