import { randomBytes, randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { AppModule } from "../../app.module";

/**
 * 12.1.a, against the real app, real Postgres and a real PDP — same bar
 * `registration-persistence-failure.e2e.test.ts` sets for itself: an HTTP
 * round trip plus the database row it should write, not a reading of the
 * code.
 *
 * `TEEN_ACCOUNTS` is forced on for this suite's OWN `Test.createTestingModule`
 * container only — `AppConfigModule`'s `loadAppConfig()` reads `process.env`
 * when THIS moduleRef is compiled, and the env var is restored in `afterAll`
 * so nothing else in the run is affected (the same "isolated container per
 * moduleRef" property `registration-persistence-failure.e2e.test.ts`'s own
 * header documents for its provider override).
 *
 * The escrow-on-revoke path (a NON-ZERO balance actually reaching
 * `ledger.escrow`) is proven at the unit level instead
 * (`guardian-consent.use-cases.test.ts`) — granting a fresh test account
 * real points first would mean driving a whole separate reward flow just to
 * set up this suite's fixture. What this suite proves for revoke is the
 * zero-balance case (a fresh teen account) end to end: the real HTTP route,
 * the real (fake-mode) ledger balance read, and the real DB transition.
 */
const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!;

let app: NestFastifyApplication;
let pool: pg.Pool;
const originalTeenAccounts = process.env["TEEN_ACCOUNTS"];

beforeAll(async () => {
  process.env["TEEN_ACCOUNTS"] = "true";
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
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

/** A distinct source per call — REGISTER_RATE_LIMIT and the guardian routes' own IP limits are per-IP. */
function randomTestIp(): string {
  const octets = randomBytes(3);
  const [a, b, c] = octets;
  return `10.${String(a)}.${String(b)}.${String(c)}`;
}

async function parentConsentStatusFor(userId: string): Promise<string | null> {
  const { rows } = await pool.query<{ parent_consent_status: string }>(
    `SELECT parent_consent_status FROM identity.user_profile WHERE user_id = $1`,
    [userId],
  );
  return rows[0]?.parent_consent_status ?? null;
}

async function latestGuardianConsentEmail(
  guardianEmail: string,
): Promise<{ body: string; token: string } | null> {
  const { rows } = await pool.query<{ body: string; metadata: { token?: string } }>(
    `SELECT body, metadata FROM platform.sim_outbox
      WHERE category = 'guardian_consent' AND recipient = $1
      ORDER BY created_at DESC LIMIT 1`,
    [guardianEmail],
  );
  const row = rows[0];
  if (row === undefined || typeof row.metadata.token !== "string") return null;
  return { body: row.body, token: row.metadata.token };
}

function registerPayload(guardianEmail: string): Record<string, unknown> {
  return {
    email: `guardian-consent-teen+${randomUUID()}@example.test`,
    password: "not-a-real-secret-12-1-a",
    region: "AU" as const,
    locale: "en-AU" as const,
    displayName: "Guardian Consent Teen",
    // 14 years old as of any date after 2026-01-01 — well inside 13-17.
    dateOfBirth: "2012-01-01",
    timezone: "Australia/Sydney",
    guardianEmail,
  };
}

describe("12.1.a — guardian consent: register -> pending -> outbox -> approve -> granted", () => {
  it("registers a 14-year-old pending, emails the guardian, and approve grants it", async () => {
    const guardianEmail = `guardian+${randomUUID()}@example.test`;

    const register = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      remoteAddress: randomTestIp(),
      headers: { "idempotency-key": randomUUID() },
      payload: registerPayload(guardianEmail),
    });
    expect(register.statusCode).toBeLessThan(300);
    const registeredBody: { userId: string; token: string } = register.json();
    const { userId } = registeredBody;

    expect(await parentConsentStatusFor(userId)).toBe("pending");

    const email = await latestGuardianConsentEmail(guardianEmail);
    expect(email).not.toBeNull();
    // The links this ticket's own spec names — approve, and the SAME link
    // with ?action=revoke — both present in the one email body.
    expect(email!.body).toContain(`/guardian/${email!.token}`);
    expect(email!.body).toContain(`/guardian/${email!.token}?action=revoke`);

    const view = await app.inject({
      method: "GET",
      url: `/api/guardian/${email!.token}`,
      remoteAddress: randomTestIp(),
    });
    expect(view.statusCode).toBe(200);
    expect(view.json()).toStrictEqual({
      status: "pending",
      displayName: "Guardian Consent Teen",
      region: "AU",
      locale: "en-AU",
    });
    // 12.1.a: no date of birth, no email address anywhere in this response.
    expect(view.body).not.toContain("2012-01-01");
    expect(view.body).not.toContain(guardianEmail);

    const approve = await app.inject({
      method: "POST",
      url: `/api/guardian/${email!.token}/approve`,
      remoteAddress: randomTestIp(),
      headers: { "idempotency-key": randomUUID() },
      payload: { confirmAdult: true },
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json()).toStrictEqual({ approved: true });

    expect(await parentConsentStatusFor(userId)).toBe("granted");

    const viewAfterApprove = await app.inject({
      method: "GET",
      url: `/api/guardian/${email!.token}`,
      remoteAddress: randomTestIp(),
    });
    expect(viewAfterApprove.json()).toMatchObject({ status: "granted" });
  });

  it("refuses confirmAdult: false with a 400 — no partial approval", async () => {
    const guardianEmail = `guardian+${randomUUID()}@example.test`;
    const register = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      remoteAddress: randomTestIp(),
      headers: { "idempotency-key": randomUUID() },
      payload: registerPayload(guardianEmail),
    });
    expect(register.statusCode).toBeLessThan(300);
    const email = await latestGuardianConsentEmail(guardianEmail);

    const approve = await app.inject({
      method: "POST",
      url: `/api/guardian/${email!.token}/approve`,
      remoteAddress: randomTestIp(),
      headers: { "idempotency-key": randomUUID() },
      payload: { confirmAdult: false },
    });
    expect(approve.statusCode).toBe(400);
  });

  it("404s an unknown token, identically to a real-but-never-issued one", async () => {
    const unknown = await app.inject({
      method: "GET",
      url: `/api/guardian/${randomUUID()}`,
      remoteAddress: randomTestIp(),
    });
    expect(unknown.statusCode).toBe(404);
  });
});

describe("12.1.a — guardian consent: revoke", () => {
  it("revokes a fresh (zero-balance) teen account and sets parent_consent_status back to revoked", async () => {
    const guardianEmail = `guardian+${randomUUID()}@example.test`;
    const register = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      remoteAddress: randomTestIp(),
      headers: { "idempotency-key": randomUUID() },
      payload: registerPayload(guardianEmail),
    });
    expect(register.statusCode).toBeLessThan(300);
    const registeredBody: { userId: string; token: string } = register.json();
    const { userId } = registeredBody;
    const email = await latestGuardianConsentEmail(guardianEmail);

    const revoke = await app.inject({
      method: "POST",
      url: `/api/guardian/${email!.token}/revoke`,
      remoteAddress: randomTestIp(),
      headers: { "idempotency-key": randomUUID() },
    });
    expect(revoke.statusCode).toBe(200);
    // A brand-new account has nothing to protect — see this file's own
    // header for where the non-zero-balance escrow case is proven instead.
    expect(revoke.json()).toStrictEqual({ revoked: true, escrowedPoints: 0 });

    expect(await parentConsentStatusFor(userId)).toBe("revoked");

    // Revoked is final: approve on the same link now refuses, not succeeds.
    const approveAfterRevoke = await app.inject({
      method: "POST",
      url: `/api/guardian/${email!.token}/approve`,
      remoteAddress: randomTestIp(),
      headers: { "idempotency-key": randomUUID() },
      payload: { confirmAdult: true },
    });
    expect(approveAfterRevoke.statusCode).toBe(409);
    expect(await parentConsentStatusFor(userId)).toBe("revoked");

    // Idempotent: revoking the already-revoked link again still reports success.
    const revokeAgain = await app.inject({
      method: "POST",
      url: `/api/guardian/${email!.token}/revoke`,
      remoteAddress: randomTestIp(),
      headers: { "idempotency-key": randomUUID() },
    });
    expect(revokeAgain.statusCode).toBe(200);
    expect(revokeAgain.json()).toStrictEqual({ revoked: true, escrowedPoints: 0 });
  });
});
