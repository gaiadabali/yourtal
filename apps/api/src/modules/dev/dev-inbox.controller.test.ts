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
import type { TestSession } from "../../shared/testing/session-for";
import { grantStaffRole, ownerPool } from "../staff/staff.test-helper";
import type { DevInboxResponse } from "./dev-inbox.schema";

/**
 * `GET /api/dev/inbox` (1.6.b), end to end against the real app, Postgres
 * and PDP — and 1.6.d's own Check, in one test: register, request email
 * verification, find it in the inbox, use its token to actually verify.
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

describe("1.6.d's Check: register -> the verification email appears in /dev/inbox -> its link verifies the account", () => {
  it("finds the entry by recipient, and its token confirms the account", async () => {
    const session = await sessionFor(app, { jurisdiction: "AU" });

    const requested = await app.inject({
      method: "POST",
      url: "/api/auth/email/verify/request",
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(requested.statusCode).toBeLessThan(300);

    // dev: open, with no session at all (local runs and the CI browser tests).
    const inbox = await app.inject({ method: "GET", url: "/api/dev/inbox" });
    expect(inbox.statusCode).toBe(200);
    const body: DevInboxResponse = inbox.json();
    expect(body.access).toBe("open");
    expect(body.viewerEmail).toBeNull();

    const entry = body.entries.find(
      (candidate) =>
        candidate.recipient === session.email && candidate.category === "email_verification",
    );
    expect(entry, "the requested verification should appear in the inbox").toBeDefined();
    expect(entry?.boundary).toBe("email");
    expect(entry?.region).toBe("AU");
    const token = entry?.metadata["token"];
    expect(typeof token).toBe("string");

    const confirmed = await app.inject({
      method: "POST",
      url: "/api/auth/email/verify/confirm",
      headers: { "idempotency-key": randomUUID() },
      payload: { token },
    });
    expect(confirmed.statusCode).toBeLessThan(300);
    expect(confirmed.json()).toMatchObject({ verified: true });
  });
});

describe("APP_ENV gates /api/dev/inbox (1.6.b)", () => {
  let productionApp: NestFastifyApplication;

  beforeAll(async () => {
    const productionConfig: AppConfig = { ...loadAppConfig(), appEnv: "production" };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(productionConfig)
      .compile();
    productionApp = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await productionApp.init();
    await productionApp.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await productionApp.close();
  });

  it("404s in production, rather than revealing the route exists", async () => {
    const response = await productionApp.inject({ method: "GET", url: "/api/dev/inbox" });
    expect(response.statusCode).toBe(404);
  });
});

describe("staging needs a session for /api/dev/inbox, and shows a viewer only their own mail (5.13.b)", () => {
  let stagingApp: NestFastifyApplication;
  let viewer: TestSession;
  let other: TestSession;

  async function requestVerification(session: TestSession): Promise<void> {
    const requested = await stagingApp.inject({
      method: "POST",
      url: "/api/auth/email/verify/request",
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(requested.statusCode).toBeLessThan(300);
  }

  async function inboxAs(cookie?: string) {
    return stagingApp.inject({
      method: "GET",
      url: "/api/dev/inbox",
      ...(cookie === undefined ? {} : { headers: { cookie } }),
    });
  }

  beforeAll(async () => {
    const stagingConfig: AppConfig = { ...loadAppConfig(), appEnv: "staging" };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(stagingConfig)
      .compile();
    stagingApp = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await stagingApp.init();
    await stagingApp.getHttpAdapter().getInstance().ready();

    // Two real recipients in the outbox, each with a live verification link.
    viewer = await sessionFor(stagingApp, { jurisdiction: "AU" });
    other = await sessionFor(stagingApp, { jurisdiction: "AU" });
    await requestVerification(viewer);
    await requestVerification(other);
  });

  afterAll(async () => {
    await stagingApp.close();
  });

  it("answers 401 with no session, in the API's usual error shape", async () => {
    const response = await inboxAs();
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "no_session" });
    expect(response.body).not.toContain(viewer.email);
  });

  it("answers 401 for a session that does not validate", async () => {
    const response = await inboxAs("yt_session=not-a-real-session");
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "session_invalid" });
  });

  it("shows a signed-in viewer only the mail sent to their own email", async () => {
    const response = await inboxAs(viewer.cookie);
    expect(response.statusCode).toBe(200);
    const body: DevInboxResponse = response.json();
    expect(body.access).toBe("own");
    expect(body.viewerEmail).toBe(viewer.email);

    const recipients = new Set(body.entries.map((entry) => entry.recipient.toLowerCase()));
    expect(recipients).toEqual(new Set([viewer.email.toLowerCase()]));
    expect(
      body.entries.some((entry) => entry.category === "email_verification"),
      "the viewer's own verification email is still there",
    ).toBe(true);
    expect(response.body).not.toContain(other.email);
  });

  it("shows staff every entry, other people's included", async () => {
    const staff = await sessionFor(stagingApp, { jurisdiction: "AU" });
    const owner = ownerPool();
    try {
      await grantStaffRole(owner, staff.userId, "support");
    } finally {
      await owner.end();
    }

    const response = await inboxAs(staff.cookie);
    expect(response.statusCode).toBe(200);
    const body: DevInboxResponse = response.json();
    expect(body.access).toBe("staff");
    expect(body.viewerEmail).toBe(staff.email);
    const recipients = body.entries.map((entry) => entry.recipient);
    expect(recipients).toContain(viewer.email);
    expect(recipients).toContain(other.email);
  });
});
