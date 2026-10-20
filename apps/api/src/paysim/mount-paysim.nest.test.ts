import "reflect-metadata";
import { Body, Controller, Module, Post } from "@nestjs/common";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { ZodValidationPipe } from "nestjs-zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMemoryPaySimStore } from "@yourtal/paysim/memory-store";
import { loadAppConfig } from "../config/app-config";
import { mountPaySim } from "./mount-paysim";

@Controller("api/echo")
class EchoController {
  @Post()
  echo(@Body() body: unknown): unknown {
    return { got: body };
  }
}

@Module({ controllers: [EchoController] })
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS module classes carry only decorator metadata
class EchoModule {}

/**
 * Mounted the way main.ts does it: on the raw Fastify instance of a Nest app,
 * before init, with Nest's rawBody and global pipe on. Proves the simulation's
 * form parser stays inside its prefix and Nest's own routes are untouched.
 */
describe("mountPaySim inside a Nest app", () => {
  let app: NestFastifyApplication;
  const key = "sk_test_paysim_dev";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [EchoModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      rawBody: true,
    });
    app.useGlobalPipes(new ZodValidationPipe());
    const config = loadAppConfig({
      DATABASE_URL: "postgres://yourtal_app:app_local_only@127.0.0.1:26432/yourtal",
      CHECKPOINT_TOKEN_SECRET: "test-only-checkpoint-signing-key-not-a-real-secret",
      WEBHOOK_SECRET_ENCRYPTION_KEY: "test-only-webhook-secret-encryption-key-not-a-real-secret",
      SNAP_APP_PARTNER_SECRET: "test-only-snap-app-partner-secret-not-a-real-secret",
      PAYSIM_ENABLED: "true",
    });
    await mountPaySim(app.getHttpAdapter().getInstance(), config, createMemoryPaySimStore());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it("serves Stripe form posts and pages under /api/paysim", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/paysim/v1/customers",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: "email=nest%40example.test&metadata[reference]=r1",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ email: "nest@example.test", metadata: { reference: "r1" } });
    const page = await app.inject({ url: "/api/paysim/checkout/cs_test_none" });
    expect(page.statusCode).toBe(404);
    expect(page.headers["content-type"]).toContain("text/html");
  });

  it("leaves Nest's own JSON routes alone", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/echo",
      headers: { "content-type": "application/json" },
      payload: '{"a":1}',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ got: { a: 1 } });
  });
});
