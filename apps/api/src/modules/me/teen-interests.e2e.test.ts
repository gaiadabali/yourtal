import { randomBytes, randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { sessionFor } from "../../shared/testing/session-for";

/**
 * TASKS.md 12.2.a, end to end: a teen account may declare only
 * `TEEN_INTEREST_NODE_IDS`, and the server refuses anything wider regardless
 * of what a caller sends -- the Me picker only ever OFFERS the allowlist,
 * this proves the boundary is not merely cosmetic.
 *
 * Own `app` instance, same "isolated container" reasoning
 * `guardian-consent.e2e.test.ts` documents: `TEEN_ACCOUNTS` is forced on for
 * THIS moduleRef only, restored in `afterAll`, so the shared
 * `me.controller.e2e.test.ts` app (which never sets it) is unaffected. A
 * teen registers directly (not via `sessionFor`, which has no
 * `guardianEmail` field) — same shape `guardian-consent.e2e.test.ts` uses:
 * `POST /api/auth/register` already returns `{ userId, token }`, so no
 * separate login call is needed either.
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
      email: `teen-interests+${randomUUID()}@example.test`,
      password: "not-a-real-secret-12-2-a",
      region: "AU" as const,
      locale: "en-AU" as const,
      displayName: "Teen Interests Test",
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

describe("PUT /api/me/interests, a teen account", () => {
  it("refuses an interest outside the teen allowlist, but accepts one inside it", async () => {
    const { cookie } = await registerTeen();

    const outOfReach = await app.inject({
      method: "PUT",
      url: "/api/me/interests",
      headers: { cookie },
      payload: { nodeIds: ["finance"] },
    });
    expect(outOfReach.statusCode).toBe(400);
    expect(outOfReach.json<{ message: string }>().message).toContain("finance");

    const allowed = await app.inject({
      method: "PUT",
      url: "/api/me/interests",
      headers: { cookie },
      payload: { nodeIds: ["games", "books"] },
    });
    expect(allowed.statusCode).toBe(200);

    const listed = await app.inject({
      method: "GET",
      url: "/api/me/interests",
      headers: { cookie },
    });
    expect(listed.json<{ nodeIds: string[] }>().nodeIds.sort()).toEqual(["books", "games"]);
  });

  it("an adult declaring the same node ids is unaffected by the teen allowlist", async () => {
    const session = await sessionFor(app); // default DOB is comfortably adult

    const response = await app.inject({
      method: "PUT",
      url: "/api/me/interests",
      headers: { cookie: session.cookie },
      payload: { nodeIds: ["finance", "travel"] },
    });
    expect(response.statusCode).toBe(200);
  });
});
