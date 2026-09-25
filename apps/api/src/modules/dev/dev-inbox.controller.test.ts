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
      headers: { authorization: `Bearer ${session.token}`, ...session.headers },
    });
    expect(requested.statusCode).toBeLessThan(300);

    const inbox = await app.inject({ method: "GET", url: "/api/dev/inbox" });
    expect(inbox.statusCode).toBe(200);
    const body: DevInboxResponse = inbox.json();

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
