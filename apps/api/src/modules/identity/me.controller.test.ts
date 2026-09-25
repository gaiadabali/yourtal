import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { APP_CONFIG } from "../../config/app-config.module";
import { loadAppConfig } from "../../config/app-config";
import type { AppConfig } from "../../config/app-config";
import { sessionFor } from "../../shared/testing/session-for";

/**
 * `GET`/`PATCH /api/me` (1.4.d), end to end against the real app, real
 * Postgres and a real PDP — `sessionFor` does a genuine
 * `POST /api/auth/register` + `/login` round trip (1.4.c), so every
 * assertion below reads back what `identity.user_profile` actually stored,
 * not a fixture.
 */

let app: NestFastifyApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

describe("GET /api/me", () => {
  it("returns the profile an AU adult registered with", async () => {
    const session = await sessionFor(app, { jurisdiction: "AU", dateOfBirth: "1990-06-15" });

    const response = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: session.headers,
    });

    expect(response.statusCode).toBe(200);
    const body: unknown = response.json();
    expect(body).toStrictEqual({
      profile: {
        userId: session.userId,
        region: "AU",
        displayLocale: "en-AU",
        displayName: "Session For",
        ageBand: "adult",
        timezone: "Australia/Sydney",
      },
      businessMemberships: [],
      staffRoles: [],
    });
  });

  it("returns the profile an ID adult registered with, region and locale together", async () => {
    const session = await sessionFor(app, { jurisdiction: "ID", dateOfBirth: "1985-01-01" });

    const response = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: session.headers,
    });

    expect(response.statusCode).toBe(200);
    const body: unknown = response.json();
    expect(body).toMatchObject({
      profile: { region: "ID", displayLocale: "id-ID", ageBand: "adult" },
    });
  });

  it("refuses an anonymous caller", async () => {
    const response = await app.inject({ method: "GET", url: "/api/me" });
    expect(response.statusCode).toBe(403);
  });
});

describe("PATCH /api/me", () => {
  it("changes displayName and displayLocale, and GET reflects it afterwards", async () => {
    const session = await sessionFor(app, { jurisdiction: "AU" });

    const patched = await app.inject({
      method: "PATCH",
      url: "/api/me",
      headers: { ...session.headers, "idempotency-key": randomUUID() },
      payload: { displayName: "Changed Name", displayLocale: "id-ID" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      profile: { displayName: "Changed Name", displayLocale: "id-ID" },
    });

    const reread = await app.inject({ method: "GET", url: "/api/me", headers: session.headers });
    expect(reread.json()).toMatchObject({
      profile: { displayName: "Changed Name", displayLocale: "id-ID", region: "AU" },
    });
  });

  it("never changes region — there is no field for it on the request", async () => {
    const session = await sessionFor(app, { jurisdiction: "AU" });

    // `region` is not in updateMeSchema at all, so a client that sends it
    // anyway must see it silently ignored, not applied.
    const patched = await app.inject({
      method: "PATCH",
      url: "/api/me",
      headers: { ...session.headers, "idempotency-key": randomUUID() },
      payload: { region: "ID", displayName: "Still AU" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ profile: { region: "AU", displayName: "Still AU" } });
  });

  it("refuses an anonymous caller", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/me",
      headers: { "idempotency-key": randomUUID() },
      payload: { displayName: "Nope" },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe("1.4.g's Check: the age policy at registration, TEEN_ACCOUNTS off (the default)", () => {
  it("register -> GET /api/me shows region AU, locale en-AU and age band adult", async () => {
    const session = await sessionFor(app, { jurisdiction: "AU", dateOfBirth: "2000-01-01" });
    const response = await app.inject({ method: "GET", url: "/api/me", headers: session.headers });
    expect(response.json()).toMatchObject({
      profile: { region: "AU", displayLocale: "en-AU", ageBand: "adult" },
    });
  });

  it("refuses a 15-year-old outright", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      remoteAddress: "10.9.9.1",
      headers: { "idempotency-key": randomUUID() },
      payload: {
        email: `teen-${randomUUID()}@example.test`,
        password: "not-a-real-secret-either-1",
        region: "AU",
        locale: "en-AU",
        displayName: "Fifteen",
        // Comfortably 15 today, whenever "today" is.
        dateOfBirth: "2011-01-01",
        timezone: "Australia/Sydney",
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "below_minimum_age" });
  });

  it("refuses under-13 neutrally, with no age disclosed, and blocks a retry for 24h", async () => {
    const remoteAddress = "10.9.9.2";
    const attempt = () =>
      app.inject({
        method: "POST",
        url: "/api/auth/register",
        remoteAddress,
        headers: { "idempotency-key": randomUUID() },
        payload: {
          email: `child-${randomUUID()}@example.test`,
          password: "not-a-real-secret-either-2",
          region: "AU",
          locale: "en-AU",
          displayName: "Twelve",
          dateOfBirth: "2015-01-01",
          timezone: "Australia/Sydney",
        },
      });

    const first = await attempt();
    expect(first.statusCode).toBe(403);
    const firstBody: unknown = first.json();
    expect(firstBody).toStrictEqual({
      code: "too_young",
      message: "You can't create an account yet.",
    });
    expect(JSON.stringify(firstBody)).not.toMatch(/\d{4}-\d{2}-\d{2}|13|12|11/);
    const setCookie = first.headers["set-cookie"];
    expect(setCookie).toEqual(expect.stringContaining("yt_signup_blocked=1"));

    // A retry from the SAME source, carrying the cookie the first refusal
    // set, must be blocked before AuthService (or a different date of
    // birth) is even consulted — same neutral shape either way.
    const retry = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      remoteAddress,
      headers: {
        "idempotency-key": randomUUID(),
        cookie: "yt_signup_blocked=1",
      },
      payload: {
        email: `child-retry-${randomUUID()}@example.test`,
        password: "not-a-real-secret-either-3",
        region: "AU",
        locale: "en-AU",
        displayName: "Trying Again",
        // A DIFFERENT date of birth — proves the block is not re-deriving
        // its answer from this submission at all.
        dateOfBirth: "2020-01-01",
        timezone: "Australia/Sydney",
      },
    });
    expect(retry.statusCode).toBe(403);
    expect(retry.json()).toStrictEqual({
      code: "too_young",
      message: "You can't create an account yet.",
    });
  });
});

describe("1.4.b: TEEN_ACCOUNTS on", () => {
  let teenApp: NestFastifyApplication;

  beforeAll(async () => {
    const teenConfig: AppConfig = { ...loadAppConfig(), teenAccounts: true };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(teenConfig)
      .compile();
    teenApp = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await teenApp.init();
    await teenApp.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await teenApp.close();
  });

  it("refuses a 13-17-year-old with no guardianEmail", async () => {
    const response = await teenApp.inject({
      method: "POST",
      url: "/api/auth/register",
      remoteAddress: "10.9.9.3",
      headers: { "idempotency-key": randomUUID() },
      payload: {
        email: `teen-noconsent-${randomUUID()}@example.test`,
        password: "not-a-real-secret-either-4",
        region: "AU",
        locale: "en-AU",
        displayName: "Fifteen",
        dateOfBirth: "2011-01-01",
        timezone: "Australia/Sydney",
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "guardian_email_required" });
  });

  it("creates a pending teen account with a guardianEmail, and GET /api/me shows ageBand teen", async () => {
    const email = `teen-consented-${randomUUID()}@example.test`;
    const registered = await teenApp.inject({
      method: "POST",
      url: "/api/auth/register",
      remoteAddress: "10.9.9.4",
      headers: { "idempotency-key": randomUUID() },
      payload: {
        email,
        password: "not-a-real-secret-either-5",
        region: "AU",
        locale: "en-AU",
        displayName: "Fifteen",
        dateOfBirth: "2011-01-01",
        timezone: "Australia/Sydney",
        guardianEmail: "guardian@example.test",
      },
    });
    expect(registered.statusCode).toBe(201);
    const { userId } = registered.json();

    const response = await teenApp.inject({
      method: "GET",
      url: "/api/me",
      headers: { "x-yt-user-id": userId, "x-yt-jurisdiction": "AU" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      profile: { region: "AU", ageBand: "teen", displayName: "Fifteen" },
    });
  });

  it("still refuses under-13 the same neutral way, even with the flag on", async () => {
    const response = await teenApp.inject({
      method: "POST",
      url: "/api/auth/register",
      remoteAddress: "10.9.9.5",
      headers: { "idempotency-key": randomUUID() },
      payload: {
        email: `child-teenflag-${randomUUID()}@example.test`,
        password: "not-a-real-secret-either-6",
        region: "AU",
        locale: "en-AU",
        displayName: "Twelve",
        dateOfBirth: "2015-01-01",
        timezone: "Australia/Sydney",
        guardianEmail: "guardian@example.test",
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toStrictEqual({
      code: "too_young",
      message: "You can't create an account yet.",
    });
  });
});
