import { randomBytes, randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../../app.module";
import { sessionFor } from "../../../shared/testing/session-for";
import { verifyMailToken } from "../mail-token";

/**
 * Spambank's session routes end to end (spambank/BUILD.md 5.1): the real app, real Postgres and the
 * real Cerbos policy, with the simulated driver (so no mail server). What the policy decides is
 * asserted through HTTP: an adult switches on, opens, manages app passwords and deletes; a teen, a
 * signed-out caller and a mailbox of someone else get nothing. Own `app`, with `TEEN_ACCOUNTS` and the
 * token key set for this moduleRef only.
 */
const KEY = "e2e-spambank-token-key-0123456789abcdef-not-a-real-key";
const saved = {
  teen: process.env["TEEN_ACCOUNTS"],
  key: process.env["SPAMBANK_TOKEN_KEY"],
  driver: process.env["SPAMBANK_DRIVER"],
  enabled: process.env["SPAMBANK_ENABLED"],
};
let app: NestFastifyApplication;
let pool: Pool;
const users: string[] = [];
const retiredNames: string[] = [];

beforeAll(async () => {
  process.env["TEEN_ACCOUNTS"] = "true";
  process.env["SPAMBANK_TOKEN_KEY"] = KEY;
  delete process.env["SPAMBANK_DRIVER"];
  delete process.env["SPAMBANK_ENABLED"];
  pool = new Pool({ connectionString: process.env["DATABASE_URL"] });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
  const owner = new Pool({ connectionString: process.env["DATABASE_OWNER_URL"] });
  const mailboxes = await owner.query<{ local_part: string }>(
    `SELECT local_part FROM spambank.mailbox WHERE user_id = ANY($1)`,
    [users],
  );
  await owner.query(`DELETE FROM spambank.mailbox WHERE user_id = ANY($1)`, [users]);
  await owner.query(`DELETE FROM spambank.retired_name WHERE local_part = ANY($1)`, [
    [...retiredNames, ...mailboxes.rows.map((row) => row.local_part)],
  ]);
  await owner.end();
  await pool.end();
  for (const [name, value] of [
    ["TEEN_ACCOUNTS", saved.teen],
    ["SPAMBANK_TOKEN_KEY", saved.key],
    ["SPAMBANK_DRIVER", saved.driver],
    ["SPAMBANK_ENABLED", saved.enabled],
  ] as const) {
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = value;
  }
});

/** A distinct source per call: REGISTER_RATE_LIMIT is per-IP. */
function randomTestIp(): string {
  const [a, b, c] = randomBytes(3);
  return `10.${String(a)}.${String(b)}.${String(c)}`;
}

async function registerTeen(): Promise<{ cookie: string; userId: string }> {
  const register = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    remoteAddress: randomTestIp(),
    headers: { "idempotency-key": randomUUID() },
    payload: {
      email: `spambank-teen+${randomUUID()}@example.test`,
      password: "not-a-real-secret-12-2-a",
      region: "AU" as const,
      locale: "en-AU" as const,
      displayName: "Spambank Teen",
      dateOfBirth: "2012-01-01",
      timezone: "Australia/Sydney",
      acceptGodNotice: true,
      guardianEmail: `guardian+${randomUUID()}@example.test`,
    },
  });
  expect(register.statusCode).toBeLessThan(300);
  const { token, userId } = register.json<{ userId: string; token: string }>();
  users.push(userId);
  return { cookie: `yt_session=${token}`, userId };
}

describe("GET/POST /api/spambank/me, an adult", () => {
  it("switches on with a 201, again with a 200, opens it, and keeps a name of the right form", async () => {
    const session = await sessionFor(app, { jurisdiction: "AU" });
    users.push(session.userId);
    const headers = { cookie: session.cookie };

    const off = await app.inject({ method: "GET", url: "/api/spambank/me", headers });
    expect(off.statusCode).toBe(200);
    expect(off.json()).toEqual({ available: true, state: "off" });

    const first = await app.inject({ method: "POST", url: "/api/spambank/me/enable", headers });
    expect(first.statusCode).toBe(201);
    const { address, created } = first.json<{ address: string; created: boolean }>();
    expect(created).toBe(true);
    expect(address).toMatch(/^[a-z]{6,16}([1-9][0-9])?@yourtal\.gaiada\.com$/);

    const again = await app.inject({ method: "POST", url: "/api/spambank/me/enable", headers });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ state: "on", address, created: false });

    const row = await pool.query<{ status: string; region: string; enabled_via: string }>(
      `SELECT status, region, enabled_via FROM spambank.mailbox WHERE user_id = $1`,
      [session.userId],
    );
    expect(row.rows).toEqual([{ status: "active", region: "AU", enabled_via: "yourtal" }]);

    const status = await app.inject({ method: "GET", url: "/api/spambank/me", headers });
    expect(status.json()).toMatchObject({ available: true, state: "on", address });

    const opened = await app.inject({ method: "POST", url: "/api/spambank/me/session", headers });
    expect(opened.statusCode).toBe(200);
    const token = opened.json<{ token: string; address: string }>();
    expect(token.address).toBe(address);
    const verified = verifyMailToken(token.token, KEY);
    expect(verified.ok && verified.payload.u).toBe(session.userId);
    expect(verified.ok && verified.payload.a).toBe("yourtal");
  });

  it("makes, lists and revokes an app password", async () => {
    const session = await sessionFor(app, { jurisdiction: "ID" });
    users.push(session.userId);
    const headers = { cookie: session.cookie };
    await app.inject({ method: "POST", url: "/api/spambank/me/enable", headers });

    const created = await app.inject({
      method: "POST",
      url: "/api/spambank/me/app-passwords",
      headers,
      payload: { name: "Pixel mail" },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json<{ id: string; secret: string; imap: { port: number } }>();
    expect(body.secret).toMatch(/^app_/);
    expect(body.imap.port).toBe(993);

    const listed = await app.inject({
      method: "GET",
      url: "/api/spambank/me/app-passwords",
      headers,
    });
    expect(listed.json<{ items: { name: string }[] }>().items.map((item) => item.name)).toEqual([
      "Pixel mail",
    ]);
    const revoked = await app.inject({
      method: "DELETE",
      url: `/api/spambank/me/app-passwords/${body.id}`,
      headers,
    });
    expect(revoked.statusCode).toBe(204);
  });

  it("deletes the mailbox with a 202 and retires the name: the next switch-on is a different address", async () => {
    const session = await sessionFor(app, { jurisdiction: "AU" });
    users.push(session.userId);
    const headers = { cookie: session.cookie };
    const first = (
      await app.inject({ method: "POST", url: "/api/spambank/me/enable", headers })
    ).json<{ address: string }>();
    retiredNames.push(first.address.split("@")[0] ?? "");

    const deleted = await app.inject({ method: "DELETE", url: "/api/spambank/me", headers });
    expect(deleted.statusCode).toBe(202);
    const retired = await pool.query(`SELECT 1 FROM spambank.retired_name WHERE local_part = $1`, [
      first.address.split("@")[0],
    ]);
    expect(retired.rowCount).toBe(1);

    const second = await app.inject({ method: "POST", url: "/api/spambank/me/enable", headers });
    expect(second.statusCode).toBe(201);
    expect(second.json<{ address: string }>().address).not.toBe(first.address);
  });

  it("cannot reach another person's mailbox: each caller's session names only their own", async () => {
    const ana = await sessionFor(app, { jurisdiction: "AU" });
    const budi = await sessionFor(app, { jurisdiction: "AU" });
    users.push(ana.userId, budi.userId);
    const anaAddress = (
      await app.inject({
        method: "POST",
        url: "/api/spambank/me/enable",
        headers: { cookie: ana.cookie },
      })
    ).json<{ address: string }>().address;
    const budiStatus = await app.inject({
      method: "GET",
      url: "/api/spambank/me",
      headers: { cookie: budi.cookie },
    });
    expect(budiStatus.json()).toEqual({ available: true, state: "off" });
    const budiSession = await app.inject({
      method: "POST",
      url: "/api/spambank/me/session",
      headers: { cookie: budi.cookie },
    });
    expect(budiSession.statusCode).toBe(409);
    expect(budiSession.body).not.toContain(anaAddress);
  });
});

describe("a teen and a signed-out caller", () => {
  it("is told it is not allowed (view) and refused everything else by the policy", async () => {
    const teen = await registerTeen();
    const headers = { cookie: teen.cookie };
    const status = await app.inject({ method: "GET", url: "/api/spambank/me", headers });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({ available: true, state: "not_allowed" });

    for (const [method, url] of [
      ["POST", "/api/spambank/me/enable"],
      ["POST", "/api/spambank/me/session"],
      ["GET", "/api/spambank/me/app-passwords"],
      ["POST", "/api/spambank/me/app-passwords"],
      ["DELETE", "/api/spambank/me"],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        headers,
        ...(method === "POST" && url.endsWith("app-passwords") ? { payload: { name: "x" } } : {}),
      });
      expect(response.statusCode, `${method} ${url}`).toBe(403);
    }
    const rows = await pool.query(`SELECT 1 FROM spambank.mailbox WHERE user_id = $1`, [
      teen.userId,
    ]);
    expect(rows.rowCount).toBe(0);
  });

  it("gets 401 without a session, on every route", async () => {
    for (const [method, url] of [
      ["GET", "/api/spambank/me"],
      ["POST", "/api/spambank/me/enable"],
      ["POST", "/api/spambank/me/session"],
      ["GET", "/api/spambank/me/app-passwords"],
      ["DELETE", "/api/spambank/me"],
    ] as const) {
      const response = await app.inject({ method, url });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });
});

describe("the machine routes", () => {
  it("refuse a call with no token, and one with a person's session cookie", async () => {
    const none = await app.inject({
      method: "POST",
      url: "/api/oidc-clients/spambank/status",
      payload: { sub: "x" },
    });
    expect([401, 404]).toContain(none.statusCode);
    const session = await sessionFor(app, { jurisdiction: "AU" });
    users.push(session.userId);
    const cookie = await app.inject({
      method: "POST",
      url: "/api/oidc-clients/spambank/status",
      headers: { cookie: session.cookie },
      payload: { sub: "x" },
    });
    expect([401, 404]).toContain(cookie.statusCode);
  });
});
