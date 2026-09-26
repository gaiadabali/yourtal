import { randomBytes, randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { AppModule } from "../../app.module";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { USER_PROFILE_REPOSITORY } from "../identity/persistence/user-profile.repository";
import type {
  NewUserProfile,
  UserProfileRepository,
} from "../identity/persistence/user-profile.repository";
import { DrizzleUserProfileRepository } from "../identity/persistence/drizzle-user-profile.repository";

/**
 * 2.5.c (F31), against the real app, real Postgres and a real PDP.
 *
 * `AuthService.register` used to write `identity.credential` and
 * `identity.user_profile` in two separate calls with no shared transaction
 * — a failure writing the profile after the credential had already
 * committed left a real, signed-in-capable account with no profile row
 * (F31). 2.5 closes that by opening ONE transaction (`AuthService.register`'s
 * own comment) over both writes; this proves the closure by forcing the
 * profile write to fail for real, through DI — the least invasive of the
 * options 2.5.c names, no DB trigger or schema change needed — rather than
 * by reasoning about the transaction from outside it.
 *
 * `USER_PROFILE_REPOSITORY` is overridden for THIS suite's own app instance
 * only (`Test.createTestingModule` builds an independent DI container per
 * `moduleRef`), so nothing else in the test run is affected.
 */
// No literal fallback (YT-0571): `vitest.config.ts`'s `setupFiles` already
// refuses to run this suite unless `DATABASE_URL` names a `yourtal_test_*`
// database, so it is as safe a fallback here as `TEST_DATABASE_URL`.
const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!;

let app: NestFastifyApplication;
let pool: pg.Pool;
let failProfileWrites = false;

// Delegates to a REAL `DrizzleUserProfileRepository` when not simulating a
// failure — this has to actually reach Postgres for the "second register
// succeeds" half of 2.5.c to mean anything (a no-op stub would make
// `profileCountFor` read back zero even on success, proving nothing).
const realProfiles = new DrizzleUserProfileRepository(createAppDb(DATABASE_URL));
const failingProfiles: UserProfileRepository = {
  create: (profile: NewUserProfile, tx) => {
    if (failProfileWrites) {
      return Promise.reject(new Error("simulated profile write failure (2.5.c)"));
    }
    return realProfiles.create(profile, tx);
  },
  findByUserId: (userId) => realProfiles.findByUserId(userId),
  update: (userId, patch) => realProfiles.update(userId, patch),
};

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(USER_PROFILE_REPOSITORY)
    .useValue(failingProfiles)
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

/** A distinct source per call — `REGISTER_RATE_LIMIT`/`LOGIN_RATE_LIMIT` are
 * per-IP, and every call through `app.inject` would otherwise share one. */
function randomTestIp(): string {
  const octets = randomBytes(3);
  const [a, b, c] = octets;
  return `10.${String(a)}.${String(b)}.${String(c)}`;
}

async function credentialCountFor(email: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM identity.credential WHERE kind = 'password' AND identifier = $1`,
    [email.trim().toLowerCase()],
  );
  return Number(rows[0]?.n ?? "0");
}

async function profileCountFor(email: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM identity.user_profile p
       JOIN identity.credential c ON c.user_id = p.user_id
      WHERE c.kind = 'password' AND c.identifier = $1`,
    [email.trim().toLowerCase()],
  );
  return Number(rows[0]?.n ?? "0");
}

describe("2.5.c (F31) — a profile-write failure leaves no row, and the same email registers again", () => {
  it("register -> persistence_unavailable, login refused, second register succeeds; exactly one credential + one profile survive", async () => {
    const email = `f31-persistence-failure+${randomUUID()}@example.test`;
    const password = "not-a-real-secret-2-5-c";
    const registerPayload = {
      email,
      password,
      region: "AU" as const,
      locale: "en-AU" as const,
      displayName: "F31 Test",
      dateOfBirth: "1990-01-01",
      timezone: "Australia/Sydney",
    };

    failProfileWrites = true;
    const firstAttempt = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      remoteAddress: randomTestIp(),
      headers: { "idempotency-key": randomUUID() },
      payload: registerPayload,
    });
    // `to-http-exception.ts`'s existing convention for `persistence_failed`
    // (503, `persistence_unavailable`) — not a new code invented for this
    // ticket.
    expect(firstAttempt.statusCode).toBe(503);
    expect(firstAttempt.json()).toMatchObject({ code: "persistence_unavailable" });

    // Nothing survived the rolled-back transaction — not a leftover
    // credential with no profile (F31's exact shape), not a stray profile
    // either.
    expect(await credentialCountFor(email)).toBe(0);
    expect(await profileCountFor(email)).toBe(0);

    const loginAfterFailure = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      remoteAddress: randomTestIp(),
      payload: { email, password },
    });
    expect(loginAfterFailure.statusCode).toBe(401);
    expect(loginAfterFailure.json()).toMatchObject({ code: "invalid_credentials" });

    failProfileWrites = false;
    const secondAttempt = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      remoteAddress: randomTestIp(),
      headers: { "idempotency-key": randomUUID() },
      payload: registerPayload,
    });
    expect(secondAttempt.statusCode).toBeLessThan(300);
    const body: unknown = secondAttempt.json();
    expect(body).toMatchObject({ userId: expect.any(String), token: expect.any(String) });

    // Exactly one credential and one profile now — the failed attempt left
    // nothing behind for the successful one to collide with or duplicate.
    expect(await credentialCountFor(email)).toBe(1);
    expect(await profileCountFor(email)).toBe(1);

    const loginAfterSuccess = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      remoteAddress: randomTestIp(),
      payload: { email, password },
    });
    expect(loginAfterSuccess.statusCode).toBeLessThan(300);
  });
});
