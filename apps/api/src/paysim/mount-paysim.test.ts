import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { createMemoryPaySimStore } from "@yourtal/paysim/memory-store";
import { loadAppConfig } from "../config/app-config";
import { PAYSIM_PREFIX, mountPaySim } from "./mount-paysim";

const env = {
  DATABASE_URL:
    process.env["DATABASE_URL"] ?? "postgres://yourtal_app:app_local_only@127.0.0.1:26432/yourtal",
  CHECKPOINT_TOKEN_SECRET: "test-only-checkpoint-signing-key-not-a-real-secret",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "test-only-webhook-secret-encryption-key-not-a-real-secret",
  SNAP_APP_PARTNER_SECRET: "test-only-snap-app-partner-secret-not-a-real-secret",
  HLS_SIGNING_SECRET: "test-only-hls-signing-secret-not-a-real-one",
  TOTP_SECRET_ENCRYPTION_KEY: "test-only-totp-secret-encryption-key-not-a-real-one",
};

describe("mountPaySim (5.1.e)", () => {
  it("does nothing unless PAYSIM_ENABLED=true", async () => {
    const app = Fastify();
    expect(await mountPaySim(app, loadAppConfig(env))).toBe(false);
    await app.ready();
    const res = await app.inject({ url: `${PAYSIM_PREFIX}/v1/balance` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("refuses to mount on APP_ENV=production", async () => {
    const app = Fastify();
    const config = loadAppConfig({ ...env, APP_ENV: "production", PAYSIM_ENABLED: "true" });
    await expect(mountPaySim(app, config)).rejects.toThrow(/production/);
    await app.close();
  });

  it("answers Stripe's API under /api/paysim, outside Nest's pipeline, with the shared key", async () => {
    const app = Fastify();
    const config = loadAppConfig({ ...env, PAYSIM_ENABLED: "true" });
    expect(await mountPaySim(app, config, createMemoryPaySimStore())).toBe(true);
    await app.ready();
    const ok = await app.inject({
      url: `${PAYSIM_PREFIX}/v1/balance`,
      headers: { authorization: `Bearer ${config.stripe?.secretKey ?? ""}` },
    });
    expect(ok.statusCode).toBe(200);
    const denied = await app.inject({
      url: `${PAYSIM_PREFIX}/v1/balance`,
      headers: { authorization: "Bearer sk_test_nope_1234" },
    });
    expect(denied.statusCode).toBe(401);
    await app.close();
  });

  it("runs against the app's own database pool, as the unprivileged role, and closes it", async () => {
    const app = Fastify();
    const config = loadAppConfig({ ...env, PAYSIM_ENABLED: "true" });
    await mountPaySim(app, config);
    await app.ready();
    const headers = {
      authorization: `Bearer ${config.stripe?.secretKey ?? ""}`,
      "content-type": "application/x-www-form-urlencoded",
    };
    const created = await app.inject({
      method: "POST",
      url: `${PAYSIM_PREFIX}/v1/customers`,
      headers,
      payload: "email=mount%40example.test",
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().id;
    const got = await app.inject({ url: `${PAYSIM_PREFIX}/v1/customers/${id}`, headers });
    expect(got.json().email).toBe("mount@example.test");
    await app.close();
  });
});
