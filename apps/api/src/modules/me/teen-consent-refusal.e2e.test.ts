import { randomBytes, randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { sessionFor } from "../../shared/testing/session-for";

/**
 * TASKS.md 12.4.b (#2): a teen may not self-consent to
 * `marketing_communications`/`market_research_panel`/
 * `sister_app_profile_sharing` -- refused with `teen_consent_not_allowed`
 * (403) on `POST /api/me/consents` and `POST /api/me/linked-apps/code`,
 * while an adult's own identical request succeeds. Own `app` instance,
 * same "isolated container" reasoning `teen-interests.e2e.test.ts`
 * documents.
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
      email: `teen-consent-refusal+${randomUUID()}@example.test`,
      password: "not-a-real-secret-12-4-b",
      region: "AU" as const,
      locale: "en-AU" as const,
      displayName: "Teen Consent Refusal Test",
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

describe("POST /api/me/consents, a teen account", () => {
  it.each([
    "marketing_communications",
    "market_research_panel",
    "sister_app_profile_sharing",
  ] as const)("refuses a teen granting %s with 403 teen_consent_not_allowed", async (purpose) => {
    const { cookie } = await registerTeen();

    const response = await app.inject({
      method: "POST",
      url: "/api/me/consents",
      headers: { cookie },
      payload: { purpose, state: "granted", source: "settings_toggle" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ code: string }>().code).toBe("teen_consent_not_allowed");
  });

  it("an adult granting the same purpose succeeds", async () => {
    const session = await sessionFor(app); // default DOB is comfortably adult

    const response = await app.inject({
      method: "POST",
      url: "/api/me/consents",
      headers: { cookie: session.cookie },
      payload: {
        purpose: "marketing_communications",
        state: "granted",
        source: "settings_toggle",
      },
    });
    expect(response.statusCode).toBe(201);
  });

  it("still allows a teen to WITHDRAW one of these purposes (never blocks the off switch)", async () => {
    const { cookie } = await registerTeen();

    const response = await app.inject({
      method: "POST",
      url: "/api/me/consents",
      headers: { cookie },
      payload: {
        purpose: "marketing_communications",
        state: "withdrawn",
        source: "settings_toggle",
      },
    });
    expect(response.statusCode).toBe(201);
  });
});

describe("POST /api/me/linked-apps/code, a teen account", () => {
  it("refuses with 403 teen_consent_not_allowed", async () => {
    const { cookie } = await registerTeen();

    const response = await app.inject({
      method: "POST",
      url: "/api/me/linked-apps/code",
      headers: { cookie, "idempotency-key": randomUUID() },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ code: string }>().code).toBe("teen_consent_not_allowed");
  });

  it("an adult succeeds", async () => {
    const session = await sessionFor(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/me/linked-apps/code",
      headers: { cookie: session.cookie, "idempotency-key": randomUUID() },
    });
    expect(response.statusCode).toBe(201);
  });
});
