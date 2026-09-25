import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { AppModule } from "../../app.module";
import { sessionFor } from "../../shared/testing/session-for";
import { DevTokenAccess } from "./dev-token-access";

/**
 * 1.5.f: `password/change` and `password/reset/confirm` used to be
 * `@Idempotent`, which stored their `{token}` reply — a live, directly
 * usable session credential — in plaintext in `platform.idempotency`
 * (docs/audit/2026-09-25/api-backend.md section 8). They are `@NotValueMoving`
 * now instead: these tests prove, against the real app and Postgres, both
 * that no row is written AND that a retry still cannot double-apply
 * anything (the property `@Idempotent` existed to protect in the first
 * place).
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
