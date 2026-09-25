import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { AppModule } from "../../app.module";
import { sessionFor } from "../../shared/testing/session-for";
import { DevTokenAccess } from "./dev-token-access";

/**
 * 1.5.f: three `@Idempotent` routes in this controller used to store a
 * `{token}` reply — a live, directly usable session credential — in
 * plaintext in `platform.idempotency` (docs/audit/2026-09-25/api-backend.md
 * section 8, and the follow-up finding that `register` was the fourth: the
 * audit's own line numbers predated 1.4.c, which is what gave `register`
 * its `{userId, token}` reply and its `@Idempotent`).
 *
 * `password/change` and `password/reset/confirm` are `@NotValueMoving` now
 * instead — neither can double-apply on a bare retry regardless (see each
 * route's own comment), so they need no idempotency protection at all.
 * `register` is different: a REPLAY has to keep meaning "yes, this email is
 * already registered, here is its userId" without ever handing out a
 * session, so it stays `@Idempotent` with `redact: withoutToken` — the
 * response the caller who actually registered receives is untouched; only
 * the copy persisted for a future replay has `token` stripped.
 *
 * These tests prove, against the real app and Postgres, that no row
 * anywhere in `platform.idempotency` ever contains a token, and that a
 * genuine replay of `register` gets `userId` back but never `token`.
 */

let app: NestFastifyApplication;
let devTokenAccess: DevTokenAccess;
let pool: pg.Pool;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  devTokenAccess = moduleRef.get(DevTokenAccess);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const databaseUrl = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
  if (databaseUrl === undefined) throw new Error("DATABASE_URL/TEST_DATABASE_URL must be set");
  pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

async function idempotencyRowCountFor(userId: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM platform.idempotency WHERE scope = $1`,
    [`principal:${userId}`],
  );
  return Number(rows[0]?.n ?? "0");
}

describe("register", () => {
  it("the caller who registers gets a token; the stored (and replayed) copy never does", async () => {
    const idempotencyKey = randomUUID();
    const email = `auth-controller-register-test-${randomUUID()}@example.test`;
    const payload = {
      email,
      password: "auth-controller-register-not-a-real-secret-1",
      region: "AU",
      locale: "en-AU",
      displayName: "Register Redact Test",
      dateOfBirth: "1990-01-01",
      timezone: "Australia/Sydney",
    };

    const registered = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      remoteAddress: `auth-controller-register-test-${randomUUID()}`,
      headers: { "idempotency-key": idempotencyKey },
      payload,
    });
    expect(registered.statusCode).toBeLessThan(300);
    const registeredBody: { userId: string; token: string } = registered.json();
    expect(registeredBody).toHaveProperty("userId");
    expect(registeredBody).toHaveProperty("token");

    // `register` is called with no session, so `AsyncPrincipalResolver`
    // resolves the anonymous principal — every anonymous register shares
    // that ONE scope, distinguished from each other only by their own
    // idempotency key, which is why this reads by BOTH.
    const stored = await pool.query<{ body: string }>(
      `SELECT body FROM platform.idempotency WHERE scope = 'principal:anonymous' AND key = $1`,
      [idempotencyKey],
    );
    expect(stored.rows).toHaveLength(1);
    const storedBody: unknown = JSON.parse(stored.rows[0]?.body ?? "{}");
    expect(storedBody).not.toHaveProperty("token");
    expect(storedBody).toMatchObject({ userId: registeredBody.userId });
    expect(JSON.stringify(storedBody)).not.toContain(registeredBody.token);

    // A genuine replay — the SAME idempotency key — proves the point end to
    // end: it confirms the registration (userId comes back) without ever
    // handing out a session for it.
    const replay = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      remoteAddress: `auth-controller-register-test-${randomUUID()}`,
      headers: { "idempotency-key": idempotencyKey },
      payload,
    });
    expect(replay.statusCode).toBe(registered.statusCode);
    const replayBody: unknown = replay.json();
    expect(replayBody).toMatchObject({ userId: registeredBody.userId });
    expect(replayBody).not.toHaveProperty("token");
  });
});

describe("password/change", () => {
  it("succeeds, hands back a token, and writes no platform.idempotency row", async () => {
    const password = "original-password-not-a-real-secret-1";
    const session = await sessionFor(app, { jurisdiction: "AU", password });

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/password/change",
      headers: { authorization: `Bearer ${session.token}`, ...session.headers },
      payload: { currentPassword: password, newPassword: "a-brand-new-password-123" },
    });

    expect(response.statusCode).toBeLessThan(300);
    expect(response.json()).toHaveProperty("token");
    expect(await idempotencyRowCountFor(session.userId)).toBe(0);
  });

  it("a retry with the same (now-revoked) bearer token fails cleanly instead of re-applying", async () => {
    const password = "original-password-not-a-real-secret-2";
    const session = await sessionFor(app, { jurisdiction: "AU", password });

    const first = await app.inject({
      method: "POST",
      url: "/api/auth/password/change",
      headers: { authorization: `Bearer ${session.token}`, ...session.headers },
      payload: { currentPassword: password, newPassword: "a-second-brand-new-password-456" },
    });
    expect(first.statusCode).toBeLessThan(300);

    // The SAME request again, with the SAME (now-revoked) bearer token —
    // proving there is no window where this re-applies the change or
    // returns a stale, stored token, the property @Idempotent used to give
    // this route in a way that put a live credential in a shared table.
    const retry = await app.inject({
      method: "POST",
      url: "/api/auth/password/change",
      headers: { authorization: `Bearer ${session.token}`, ...session.headers },
      payload: { currentPassword: password, newPassword: "a-second-brand-new-password-456" },
    });
    expect(retry.statusCode).toBe(401);
    expect(retry.json()).toMatchObject({ code: "session_invalid" });
  });
});

describe("password/reset/confirm", () => {
  it("succeeds, hands back a token, and writes no platform.idempotency row", async () => {
    const session = await sessionFor(app, { jurisdiction: "AU" });

    const requested = await app.inject({
      method: "POST",
      url: "/api/auth/password/reset/request",
      // PASSWORD_RESET_REQUEST_RATE_LIMIT is 3/hour per source — the
      // default `remoteAddress` `app.inject` uses when none is given is
      // the SAME address on every call, which every earlier run of this
      // very test in the same hour already spent against a real (not
      // per-test-run) Redis. Same fix as auth.service.test.ts's own
      // `randomIp()`, for the identical reason.
      remoteAddress: `auth-controller-reset-request-test-${randomUUID()}`,
      payload: { email: session.email },
    });
    expect(requested.statusCode).toBeLessThan(300);

    const token = devTokenAccess.peekToken("password_reset", session.userId, Date.now()) ?? "";
    expect(token.length).toBeGreaterThan(0);

    const confirmed = await app.inject({
      method: "POST",
      url: "/api/auth/password/reset/confirm",
      payload: { token, newPassword: "reset-brand-new-password-789" },
    });
    expect(confirmed.statusCode).toBeLessThan(300);
    expect(confirmed.json()).toHaveProperty("token");
    expect(await idempotencyRowCountFor(session.userId)).toBe(0);

    // The one-time token itself already refuses a replay (proved directly
    // against the repository in auth.service.test.ts); confirmed here at
    // the HTTP layer too, since that is the property this route's removed
    // @Idempotent existed to protect.
    const replay = await app.inject({
      method: "POST",
      url: "/api/auth/password/reset/confirm",
      payload: { token, newPassword: "yet-another-password-000" },
    });
    expect(replay.statusCode).toBeGreaterThanOrEqual(400);
  });
});
