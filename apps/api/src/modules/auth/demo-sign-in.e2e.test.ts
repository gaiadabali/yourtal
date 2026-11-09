import { Test } from "@nestjs/testing";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { APP_CONFIG } from "../../config/app-config.module";
import { loadAppConfig } from "../../config/app-config";
import type { AppConfig } from "../../config/app-config";
import { sessionFor } from "../../shared/testing/session-for";
import { testDb } from "../../shared/testing/test-db";
import { sql } from "drizzle-orm";

/** Staging test kit K1.1: password-less sign-in as a seeded demo person, staging only. */
const URL = "/api/auth/demo-sign-in";
const apps: NestFastifyApplication[] = [];

async function appFor(appEnv: AppConfig["appEnv"]): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    // Teen sign-up is on by default on staging (loadAppConfig); mirror that here.
    .useValue({
      ...loadAppConfig(),
      appEnv,
      teenAccounts: appEnv === "staging",
    } satisfies AppConfig)
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  apps.push(app);
  return app;
}

const demoSignIn = (app: NestFastifyApplication, email: string) =>
  app.inject({ method: "POST", url: URL, payload: { email } });

let staging: NestFastifyApplication;

beforeAll(async () => {
  staging = await appFor("staging");
  // The demo-world reset is not run in tests; register the demo people this file uses.
  await sessionFor(staging, { email: "adult.au@demo.yourtal.test" });
  await sessionFor(staging, {
    email: "teen.au@demo.yourtal.test",
    dateOfBirth: `${String(new Date().getUTCFullYear() - 14)}-03-01`,
    guardianEmail: "guardian-of-teen@example.test",
  });
});

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
});

describe("off staging the demo sign-in does not exist", () => {
  it.each(["dev", "production"] as const)("%s: both routes are 404", async (appEnv) => {
    const app = await appFor(appEnv);
    expect((await app.inject({ method: "GET", url: URL })).statusCode).toBe(404);
    expect((await demoSignIn(app, "adult.au@demo.yourtal.test")).statusCode).toBe(404);
  });
});

describe("on staging", () => {
  it("lists the seeded demo people, with no more than a name and region", async () => {
    const res = await staging.inject({ method: "GET", url: URL });
    expect(res.statusCode).toBe(200);
    const { people } = res.json<{ people: Record<string, unknown>[] }>();
    expect(people.map((p) => p["email"])).toEqual(
      expect.arrayContaining(["viewer.au@demo.yourtal.test", "teen.au@demo.yourtal.test"]),
    );
    for (const person of people) {
      expect(Object.keys(person).sort()).toEqual(["displayName", "email", "region"]);
    }
  });

  it("signs a demo person in with a working session", async () => {
    const res = await demoSignIn(staging, " Adult.AU@demo.yourtal.test ");
    expect(res.statusCode).toBe(201);
    const { token } = res.json<{ token: string }>();
    const me = await staging.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
  });

  it("never offers or signs in a staff demo person (H1)", async () => {
    await sessionFor(staging, { email: "admin@demo.yourtal.test" });
    const listed = (await staging.inject({ method: "GET", url: URL })).json<{
      people: { email: string }[];
    }>();
    for (const staff of [
      "admin@demo.yourtal.test",
      "support@demo.yourtal.test",
      "finance@demo.yourtal.test",
      "ops@demo.yourtal.test",
      "moderator@demo.yourtal.test",
      "risk-analyst@demo.yourtal.test",
    ]) {
      expect(listed.people.map((p) => p.email)).not.toContain(staff);
      const res = await demoSignIn(staging, staff);
      expect(res.statusCode, staff).toBe(403);
    }
    expect(listed.people.map((p) => p.email)).toContain("owner.au@demo.yourtal.test");
  });

  it("refuses any account that is not a seeded demo person, even a real one", async () => {
    const real = await sessionFor(staging);
    for (const email of [real.email, "nobody@demo.yourtal.test", "owner.au@demo.yourtal.test"]) {
      const res = await demoSignIn(staging, email);
      expect(res.statusCode, email).toBe(403);
      expect(res.json()).toMatchObject({ code: "not_a_demo_account" });
    }
  });

  it("keeps the teen's guardian state: still awaiting the guardian after signing in", async () => {
    const res = await demoSignIn(staging, "teen.au@demo.yourtal.test");
    expect(res.statusCode).toBe(201);
    const me = await staging.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: `Bearer ${res.json<{ token: string }>().token}` },
    });
    expect(me.json()).toMatchObject({ awaitingGuardian: true });
  });
});

// M1: a demo-made session (amr demo) cannot change how the account signs in.
describe("a demo-made session", () => {
  let auth: { authorization: string };

  beforeAll(async () => {
    const res = await demoSignIn(staging, "adult.au@demo.yourtal.test");
    auth = { authorization: `Bearer ${res.json<{ token: string }>().token}` };
  });

  it("is stored with amr demo, never pwd", async () => {
    const result = await testDb().execute<{ amr: string[] }>(sql`
      SELECT s.amr FROM identity.session s
        JOIN identity.credential c ON c.user_id = s.user_id
       WHERE c.identifier = 'adult.au@demo.yourtal.test'
       ORDER BY s.created_at DESC LIMIT 1`);
    expect(result.rows[0]?.amr).toEqual(["demo"]);
  });

  it.each([
    ["POST", "/api/auth/totp/enrol", {}],
    ["POST", "/api/auth/totp/confirm", { code: "123456" }],
    ["POST", "/api/auth/totp/disable", { code: "123456" }],
    ["POST", "/api/auth/passkeys/register/options", {}],
    ["POST", "/api/auth/passkeys/register", { response: {} }],
    ["POST", "/api/auth/passkeys/step-up/options", {}],
    ["DELETE", "/api/auth/passkeys/some-credential", undefined],
    ["POST", "/api/auth/step-up", { code: "123456" }],
    ["POST", "/api/auth/password/change", { currentPassword: "x", newPassword: "y".repeat(12) }],
  ] as const)("%s %s is refused with 403 demo_session", async (method, url, payload) => {
    const res = await staging.inject({
      method,
      url,
      headers: auth,
      ...(payload === undefined ? {} : { payload }),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: "demo_session" });
  });

  it("can still read its sign-in methods", async () => {
    const res = await staging.inject({
      method: "GET",
      url: "/api/auth/sign-in-methods",
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
  });
});
