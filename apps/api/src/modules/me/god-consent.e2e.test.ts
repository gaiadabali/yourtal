import { randomBytes, randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { ZodValidationPipe } from "nestjs-zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { AppModule } from "../../app.module";
import { sessionFor } from "../../shared/testing/session-for";
import type { TestSession } from "../../shared/testing/session-for";

/**
 * god/TASKS.md 9.1.b/9.1.c/9.1.f, against the real app, Postgres and PDP: each
 * HTTP round trip plus the `identity.god_group_consent` row it writes.
 *
 * An "existing user" (an account from before the notice) is made by clearing
 * a fresh account's status row with `identity.forget_god_group_status`, the
 * function account deletion uses: the app role may call it, and the log rows
 * stay, exactly as for a real pre-notice account plus its later decisions.
 */
const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!;

let app: NestFastifyApplication;
let pool: pg.Pool;
const originalTeenAccounts = process.env["TEEN_ACCOUNTS"];

beforeAll(async () => {
  process.env["TEEN_ACCOUNTS"] = "true";
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useGlobalPipes(new ZodValidationPipe());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
});

afterAll(async () => {
  await app.close();
  await pool.end();
  if (originalTeenAccounts === undefined) {
    delete process.env["TEEN_ACCOUNTS"];
  } else {
    process.env["TEEN_ACCOUNTS"] = originalTeenAccounts;
  }
});

function randomTestIp(): string {
  const [a, b, c] = randomBytes(3);
  return `10.${String(a)}.${String(b)}.${String(c)}`;
}

interface StatusBody {
  notice: { id: string; version: string; url: string; teensUrl: string };
  ageBand: "adult" | "teen";
  current: {
    noticeVersion: string;
    decision: string;
    method: string;
    track: string;
    decidedAt: string;
  } | null;
  ask: boolean;
  inGod: boolean;
}

async function status(session: Pick<TestSession, "cookie">): Promise<StatusBody> {
  const response = await app.inject({
    method: "GET",
    url: "/api/me/god-consent",
    headers: { cookie: session.cookie },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<StatusBody>();
}

async function logFor(userId: string) {
  const { rows } = await pool.query<{
    notice_id: string;
    notice_version: string;
    decision: string;
    method: string;
    track: string;
  }>(
    `SELECT notice_id, notice_version, decision, method, track
       FROM identity.god_group_consent WHERE user_id = $1 ORDER BY id`,
    [userId],
  );
  return rows;
}

/** A pre-notice account: no current decision on file. */
async function existingUser(): Promise<TestSession> {
  const session = await sessionFor(app);
  await pool.query("SELECT identity.forget_god_group_status($1)", [session.userId]);
  return session;
}

function adultPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    email: `god-consent+${randomUUID()}@example.test`,
    password: "not-a-real-secret-9-1-b",
    region: "AU",
    locale: "en-AU",
    displayName: "God Consent Adult",
    dateOfBirth: "1990-01-01",
    timezone: "Australia/Sydney",
    ...over,
  };
}

describe("9.1.b: new registration", () => {
  it.each([
    ["missing", {}],
    ["unticked", { acceptGodNotice: false }],
  ])("refuses an adult with the box %s, and creates no account", async (_label, over) => {
    const payload = adultPayload(over);
    const register = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      remoteAddress: randomTestIp(),
      headers: { "idempotency-key": randomUUID() },
      payload,
    });
    expect(register.statusCode).toBe(400);
    expect(register.json<{ code: string }>().code).toBe("god_notice_required");

    const { rows } = await pool.query(
      "SELECT 1 FROM identity.credential WHERE kind = 'password' AND identifier = $1",
      [payload["email"]],
    );
    expect(rows).toHaveLength(0);
  });

  it("records the tick as accepted at registration, so nothing is asked on sign-in", async () => {
    const session = await sessionFor(app);
    const body = await status(session);
    expect(body.notice).toMatchObject({ id: "god-group-notice", version: "1.0" });
    expect(body.current).toMatchObject({
      noticeVersion: "1.0",
      decision: "accepted",
      method: "registration",
      track: "adult",
    });
    expect(body.ask).toBe(false);
    expect(body.inGod).toBe(true);
    expect(await logFor(session.userId)).toEqual([
      {
        notice_id: "god-group-notice",
        notice_version: "1.0",
        decision: "accepted",
        method: "registration",
        track: "adult",
      },
    ]);
  });
});

describe("9.1.b: an existing user on their next sign-in", () => {
  it("is asked, and Not now records declined while the app keeps working", async () => {
    const session = await existingUser();
    expect((await status(session)).ask).toBe(true);

    const declined = await app.inject({
      method: "POST",
      url: "/api/me/god-consent",
      headers: { cookie: session.cookie },
      payload: { decision: "declined", noticeVersion: "1.0" },
    });
    expect(declined.statusCode, declined.body).toBeLessThan(300);

    const after = await status(session);
    expect(after.current).toMatchObject({ decision: "declined", method: "next_sign_in" });
    expect(after.ask).toBe(false);
    expect(after.inGod).toBe(false);
    expect((await logFor(session.userId)).at(-1)).toMatchObject({
      decision: "declined",
      method: "next_sign_in",
      track: "adult",
    });

    // Never locked out: the account and its own data still answer.
    const me = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: session.cookie },
    });
    expect(me.statusCode).toBe(200);
    const consents = await app.inject({
      method: "GET",
      url: "/api/me/consents",
      headers: { cookie: session.cookie },
    });
    expect(consents.statusCode).toBe(200);
  });

  it("Accept records accepted and puts them in GOD", async () => {
    const session = await existingUser();
    const accepted = await app.inject({
      method: "POST",
      url: "/api/me/god-consent",
      headers: { cookie: session.cookie },
      payload: { decision: "accepted", noticeVersion: "1.0" },
    });
    expect(accepted.statusCode, accepted.body).toBeLessThan(300);
    expect(accepted.json<StatusBody>()).toMatchObject({ ask: false, inGod: true });
  });

  it("refuses Not now once the current notice is accepted: 409 already_accepted, status unchanged", async () => {
    const session = await existingUser();
    const accepted = await app.inject({
      method: "POST",
      url: "/api/me/god-consent",
      headers: { cookie: session.cookie },
      payload: { decision: "accepted", noticeVersion: "1.0" },
    });
    expect(accepted.statusCode, accepted.body).toBeLessThan(300);

    const declined = await app.inject({
      method: "POST",
      url: "/api/me/god-consent",
      headers: { cookie: session.cookie },
      payload: { decision: "declined", noticeVersion: "1.0" },
    });
    expect(declined.statusCode, declined.body).toBe(409);
    expect(declined.json<{ error: string }>().error).toBe("already_accepted");

    const after = await status(session);
    expect(after.current).toMatchObject({ decision: "accepted", method: "next_sign_in" });
    expect(after.inGod).toBe(true);
    expect(await logFor(session.userId)).toHaveLength(1);
  });

  it("asks again when the notice version changes, and refuses a decision on an old version", async () => {
    const session = await existingUser();
    // A decision on file against an earlier notice version.
    await pool.query(
      `INSERT INTO identity.god_group_consent
         (user_id, region, notice_id, notice_version, decision, method, track)
       VALUES ($1, 'AU', 'god-group-notice', '0.9', 'accepted', 'next_sign_in', 'adult')`,
      [session.userId],
    );
    const stale = await status(session);
    expect(stale.current).toMatchObject({ noticeVersion: "0.9", decision: "accepted" });
    expect(stale.ask).toBe(true);
    expect(stale.inGod).toBe(false);

    const old = await app.inject({
      method: "POST",
      url: "/api/me/god-consent",
      headers: { cookie: session.cookie },
      payload: { decision: "accepted", noticeVersion: "0.9" },
    });
    expect(old.statusCode).toBe(409);
    expect(old.json<{ code: string }>().code).toBe("notice_changed");
  });

  it("cannot be changed through the generic consent toggles", async () => {
    const session = await sessionFor(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/me/consents",
      headers: { cookie: session.cookie },
      payload: { purpose: "god_group_insights", state: "granted", source: "settings_toggle" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe("god_consent_not_here");
  });
});

describe("9.1.f: the withdrawal request", () => {
  it("records withdrawn, takes them out of GOD and does not ask again", async () => {
    const session = await sessionFor(app);
    const withdrawn = await app.inject({
      method: "POST",
      url: "/api/me/god-consent/withdraw",
      headers: { cookie: session.cookie },
    });
    expect(withdrawn.statusCode, withdrawn.body).toBeLessThan(300);

    const after = await status(session);
    expect(after.current).toMatchObject({ decision: "withdrawn", method: "request" });
    expect(after.inGod).toBe(false);
    expect(after.ask).toBe(false);
    expect((await logFor(session.userId)).map((row) => row.decision)).toEqual([
      "accepted",
      "withdrawn",
    ]);
  });

  it("account deletion removes the current decision, and keeps the evidence", async () => {
    const session = await sessionFor(app);
    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/me",
      headers: { cookie: session.cookie, "idempotency-key": randomUUID() },
    });
    expect(deleted.statusCode, deleted.body).toBe(200);
    const { rows } = await pool.query(
      "SELECT 1 FROM identity.god_group_consent_status WHERE user_id = $1",
      [session.userId],
    );
    expect(rows).toHaveLength(0);
    expect(await logFor(session.userId)).toHaveLength(1);
  });
});

describe("9.1.c: a teen and their guardian", () => {
  async function registerTeen() {
    const guardianEmail = `god-guardian+${randomUUID()}@example.test`;
    const session = await sessionFor(app, {
      dateOfBirth: "2012-01-01",
      guardianEmail,
    });
    const { rows } = await pool.query<{ metadata: { token?: string } }>(
      `SELECT metadata FROM platform.sim_outbox
        WHERE category = 'guardian_consent' AND recipient = $1
        ORDER BY created_at DESC LIMIT 1`,
      [guardianEmail],
    );
    const token = rows[0]?.metadata.token;
    if (typeof token !== "string") throw new Error("no guardian email found");
    return { session, token };
  }

  const approve = (token: string, payload: Record<string, unknown>) =>
    app.inject({
      method: "POST",
      url: `/api/guardian/${token}/approve`,
      remoteAddress: randomTestIp(),
      headers: { "idempotency-key": randomUUID() },
      payload,
    });

  it("the teen is never asked and cannot decide; nothing is recorded at registration", async () => {
    const { session } = await registerTeen();
    const body = await status(session);
    expect(body).toMatchObject({ ageBand: "teen", current: null, ask: false, inGod: false });

    const own = await app.inject({
      method: "POST",
      url: "/api/me/god-consent",
      headers: { cookie: session.cookie },
      payload: { decision: "accepted", noticeVersion: "1.0" },
    });
    expect(own.statusCode).toBe(403);
    expect(await logFor(session.userId)).toEqual([]);
  });

  it("the guardian must tick the teen notice to approve, and it is recorded on the teen track", async () => {
    const { session, token } = await registerTeen();

    expect((await approve(token, { confirmAdult: true })).statusCode).toBe(400);

    const approved = await approve(token, { confirmAdult: true, acceptGodNotice: true });
    expect(approved.statusCode, approved.body).toBe(201);

    expect(await logFor(session.userId)).toEqual([
      {
        notice_id: "god-group-notice",
        notice_version: "1.0",
        decision: "accepted",
        method: "guardian",
        track: "teen",
      },
    ]);
    expect(await status(session)).toMatchObject({ ask: false, inGod: true });
  });

  it("a guardian of a teen approved before the notice is asked on their link, and may say not now", async () => {
    const { session, token } = await registerTeen();
    await approve(token, { confirmAdult: true, acceptGodNotice: true });
    await pool.query("SELECT identity.forget_god_group_status($1)", [session.userId]);

    const view = await app.inject({
      method: "GET",
      url: `/api/guardian/${token}`,
      remoteAddress: randomTestIp(),
    });
    expect(view.json<{ godNotice: unknown }>().godNotice).toEqual({ ask: true, decision: null });

    const declined = await app.inject({
      method: "POST",
      url: `/api/guardian/${token}/god-notice`,
      remoteAddress: randomTestIp(),
      headers: { "idempotency-key": randomUUID() },
      payload: { decision: "declined" },
    });
    expect(declined.statusCode, declined.body).toBe(201);
    expect(await status(session)).toMatchObject({ inGod: false, ask: false });
    expect((await logFor(session.userId)).at(-1)).toMatchObject({
      decision: "declined",
      method: "guardian",
      track: "teen",
    });
  });

  it("withdrawing approval also withdraws the GOD notice", async () => {
    const { session, token } = await registerTeen();
    await approve(token, { confirmAdult: true, acceptGodNotice: true });

    const revoked = await app.inject({
      method: "POST",
      url: `/api/guardian/${token}/revoke`,
      remoteAddress: randomTestIp(),
      headers: { "idempotency-key": randomUUID() },
    });
    expect(revoked.statusCode, revoked.body).toBe(201);
    expect((await logFor(session.userId)).map((row) => row.decision)).toEqual([
      "accepted",
      "withdrawn",
    ]);
  });

  it("a teen may ask to stop through the request form", async () => {
    const { session, token } = await registerTeen();
    await approve(token, { confirmAdult: true, acceptGodNotice: true });

    const withdrawn = await app.inject({
      method: "POST",
      url: "/api/me/god-consent/withdraw",
      headers: { cookie: session.cookie },
    });
    expect(withdrawn.statusCode, withdrawn.body).toBeLessThan(300);
    expect((await logFor(session.userId)).at(-1)).toMatchObject({
      decision: "withdrawn",
      method: "request",
      track: "teen",
    });
  });
});
