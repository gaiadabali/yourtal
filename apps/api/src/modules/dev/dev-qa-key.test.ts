import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../../config/app-config";
import { loadAppConfig } from "../../config/app-config";
import { registerDevQaKey } from "./dev-qa-key";

const KEY = "qa-key-for-this-test-only-0123456789abcdef";
let app: FastifyInstance | undefined;

async function build(config: Pick<AppConfig, "appEnv" | "stagingQaKey">) {
  const instance = Fastify();
  registerDevQaKey(instance, config);
  instance.get("/api/dev/inbox", () => ({ ok: true }));
  instance.post("/api/dev/clock/run-job", () => ({ ok: true }));
  instance.get("/api/me", () => ({ ok: true }));
  await instance.ready();
  app = instance;
  return instance;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("/api/dev/* needs x-qa-key (staging test kit)", () => {
  it("is 404 for everything when STAGING_QA_KEY is unset, even with a header", async () => {
    const api = await build({ appEnv: "staging" });
    for (const [method, url] of [
      ["GET", "/api/dev/inbox"],
      ["POST", "/api/dev/clock/run-job"],
    ] as const) {
      const res = await api.inject({ method, url, headers: { "x-qa-key": KEY } });
      expect(res.statusCode).toBe(404);
    }
  });

  it("is 404 without the header or with a wrong one", async () => {
    const api = await build({ appEnv: "staging", stagingQaKey: KEY });
    expect((await api.inject({ url: "/api/dev/inbox" })).statusCode).toBe(404);
    const wrong = await api.inject({ url: "/api/dev/inbox", headers: { "x-qa-key": `${KEY}x` } });
    expect(wrong.statusCode).toBe(404);
    const short = await api.inject({ url: "/api/dev/inbox", headers: { "x-qa-key": "a" } });
    expect(short.statusCode).toBe(404);
  });

  it("passes with the right key, whatever the query string or letter case of the path", async () => {
    const api = await build({ appEnv: "staging", stagingQaKey: KEY });
    const ok = await api.inject({ url: "/api/dev/inbox?x=1", headers: { "x-qa-key": KEY } });
    expect(ok.statusCode).toBe(200);
    const upper = await api.inject({ url: "/API/DEV/inbox" });
    expect(upper.statusCode).toBe(404);
  });

  it("is 404 on production even with the right key", async () => {
    const api = await build({ appEnv: "production", stagingQaKey: KEY });
    const res = await api.inject({ url: "/api/dev/inbox", headers: { "x-qa-key": KEY } });
    expect(res.statusCode).toBe(404);
  });

  it("leaves every other route alone", async () => {
    const api = await build({ appEnv: "staging" });
    expect((await api.inject({ url: "/api/me" })).statusCode).toBe(200);
  });
});

describe("STAGING_QA_KEY config", () => {
  const base = {
    DATABASE_URL: "postgres://u:p@127.0.0.1:1/db",
    CHECKPOINT_TOKEN_SECRET: "c".repeat(32),
    WEBHOOK_SECRET_ENCRYPTION_KEY: "w".repeat(32),
    SNAP_APP_PARTNER_SECRET: "s".repeat(16),
    HLS_SIGNING_SECRET: "h".repeat(32),
  };

  it("is absent when unset", () => {
    expect(loadAppConfig({ ...base, APP_ENV: "staging" }).stagingQaKey).toBeUndefined();
  });

  it("refuses the local-only value outside dev", () => {
    const local = "local-only-staging-qa-key-not-real-0000";
    expect(() => loadAppConfig({ ...base, APP_ENV: "staging", STAGING_QA_KEY: local })).toThrow(
      /STAGING_QA_KEY/,
    );
    expect(loadAppConfig({ ...base, APP_ENV: "dev", STAGING_QA_KEY: local }).stagingQaKey).toBe(
      local,
    );
  });

  it("refuses a short key", () => {
    expect(() => loadAppConfig({ ...base, STAGING_QA_KEY: "short" })).toThrow();
  });
});
