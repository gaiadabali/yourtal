import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { APP_CONFIG } from "../../config/app-config.module";
import { loadAppConfig } from "../../config/app-config";
import type { AppConfig } from "../../config/app-config";
import { REGISTER_RATE_LIMIT } from "../../shared/rate-limit/rate-limit.decorator";

/** Staging test kit K1.2, through the real app: the guard really sees APP_ENV. */
const PER_IP = REGISTER_RATE_LIMIT.ip?.max ?? 5;
const apps: NestFastifyApplication[] = [];

async function appFor(appEnv: AppConfig["appEnv"]): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue({ ...loadAppConfig(), appEnv } satisfies AppConfig)
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  apps.push(app);
  return app;
}

/** Status codes of `PER_IP + 1` sign-ups from one address. */
async function signUps(app: NestFastifyApplication, domain: string): Promise<number[]> {
  const remoteAddress = `198.51.100.${String(Math.floor(Math.random() * 250) + 1)}`;
  const statuses: number[] = [];
  for (let i = 0; i <= PER_IP; i++) {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      remoteAddress,
      headers: { "idempotency-key": randomUUID() },
      payload: {
        email: `qa+${randomUUID()}@${domain}`,
        password: "test-address-not-a-real-secret-1",
        region: "AU",
        locale: "en-AU",
        displayName: "QA",
        dateOfBirth: "1990-01-01",
        timezone: "Australia/Sydney",
      },
    });
    statuses.push(res.statusCode);
  }
  return statuses;
}

let staging: NestFastifyApplication;
let dev: NestFastifyApplication;

beforeAll(async () => {
  staging = await appFor("staging");
  dev = await appFor("dev");
});

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
});

describe("register's per-IP limit and @example.test", () => {
  it("staging: an @example.test address is not held to the per-IP limit", async () => {
    const statuses = await signUps(staging, "example.test");
    expect(statuses.every((s) => s < 300)).toBe(true);
  });

  it("staging: any other address still is", async () => {
    expect((await signUps(staging, "example.com")).at(-1)).toBe(429);
  });

  it("off staging: @example.test is limited like everyone else", async () => {
    expect((await signUps(dev, "example.test")).at(-1)).toBe(429);
  });
});
