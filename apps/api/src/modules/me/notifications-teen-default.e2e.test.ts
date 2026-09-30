import { randomBytes, randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { sessionFor } from "../../shared/testing/session-for";

/**
 * TASKS.md 12.4.b (#8): a teen's push default is OFF for a category they
 * have never made an explicit choice on -- `points_unlocked`, the one
 * category the settings UI actually surfaces
 * (`me-notifications-section.tsx`'s own header). An adult's default is
 * unaffected (still absent from the response, same as before this
 * ticket), and an explicit choice always wins regardless of age band.
 *
 * Own `app` instance, same "isolated container" reasoning
 * `teen-interests.e2e.test.ts` documents: `TEEN_ACCOUNTS` is forced on for
 * THIS moduleRef only.
 */
let app: NestFastifyApplication;
const originalTeenAccounts = process.env["TEEN_ACCOUNTS"];

beforeAll(async () => {
  process.env["TEEN_ACCOUNTS"] = "true";
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
  if (originalTeenAccounts === undefined) {
    delete process.env["TEEN_ACCOUNTS"];
  } else {
    process.env["TEEN_ACCOUNTS"] = originalTeenAccounts;
  }
});

/** A distinct source per call -- REGISTER_RATE_LIMIT is per-IP. */
function randomTestIp(): string {
  const octets = randomBytes(3);
  const [a, b, c] = octets;
  return `10.${String(a)}.${String(b)}.${String(c)}`;
}

async function registerTeen(): Promise<{ cookie: string }> {
  const register = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    remoteAddress: randomTestIp(),
    headers: { "idempotency-key": randomUUID() },
    payload: {
      email: `teen-push-default+${randomUUID()}@example.test`,
      password: "not-a-real-secret-12-4-b",
      region: "AU" as const,
      locale: "en-AU" as const,
      displayName: "Teen Push Default Test",
      // 14 years old as of any date after 2026-01-01 -- well inside 13-17.
      dateOfBirth: "2012-01-01",
      timezone: "Australia/Sydney",
      guardianEmail: `guardian+${randomUUID()}@example.test`,
    },
  });
  expect(register.statusCode).toBeLessThan(300);
  const { token } = register.json<{ userId: string; token: string }>();
  return { cookie: `yt_session=${token}` };
}

describe("GET /api/me/notifications/preferences, push default", () => {
  it("a teen with no explicit choice sees points_unlocked push disabled", async () => {
    const { cookie } = await registerTeen();

    const response = await app.inject({
      method: "GET",
      url: "/api/me/notifications/preferences",
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ preferences: Record<string, boolean> }>().preferences).toMatchObject({
      points_unlocked: false,
    });
  });

  it("an adult with no explicit choice is unaffected (no entry, same as before this ticket)", async () => {
    const session = await sessionFor(app); // default DOB is comfortably adult

    const response = await app.inject({
      method: "GET",
      url: "/api/me/notifications/preferences",
      headers: { cookie: session.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(
      response.json<{ preferences: Record<string, boolean> }>().preferences.points_unlocked,
    ).toBeUndefined();
  });

  it("a teen's own explicit choice still wins over the age-band default", async () => {
    const { cookie } = await registerTeen();

    const set = await app.inject({
      method: "PUT",
      url: "/api/me/notifications/preferences/points_unlocked",
      headers: { cookie },
      payload: { pushEnabled: true },
    });
    expect(set.statusCode).toBe(200);

    const response = await app.inject({
      method: "GET",
      url: "/api/me/notifications/preferences",
      headers: { cookie },
    });
    expect(response.json<{ preferences: Record<string, boolean> }>().preferences).toMatchObject({
      points_unlocked: true,
    });
  });
});
