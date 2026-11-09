import { Test } from "@nestjs/testing";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { APP_CONFIG } from "../../config/app-config.module";
import { loadAppConfig } from "../../config/app-config";
import type { AppConfig } from "../../config/app-config";
import { sessionFor } from "../../shared/testing/session-for";

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
