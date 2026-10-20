import { randomBytes } from "node:crypto";
import Fastify from "fastify";
import type { AddressInfo } from "node:net";
import type { PaySimConfig } from "./config";
import { runPaySimTick } from "./dispatcher";
import { assertPaySimAllowed } from "./gate";
import { createMemoryPaySimStore } from "./memory-store";
import { registerPaySim } from "./plugin";
import type { PaySimStore } from "./store";

export interface PaySimServerOptions extends Partial<PaySimConfig> {
  port?: number;
  store?: PaySimStore;
  now?: () => Date;
  fetch?: typeof fetch;
}

export interface PaySimServer {
  baseUrl: string;
  secretKey: string;
  webhookSecret: string;
  config: PaySimConfig;
  store: PaySimStore;
  /** Sweep and deliver everything due, now. For tests: no sleeping. */
  tick(): Promise<{ swept: number; delivered: number }>;
  close(): Promise<void>;
}

/**
 * A standalone simulation on 127.0.0.1 (random port by default), backed by
 * the in-memory store and mounted at `""`, so `${baseUrl}/v1/...` works.
 */
export async function startPaySimServer(opts: PaySimServerOptions = {}): Promise<PaySimServer> {
  const config: PaySimConfig = {
    appEnv: opts.appEnv ?? "dev",
    secretKey: opts.secretKey ?? `sk_test_paysim_${randomBytes(12).toString("hex")}`,
    webhookSecret: opts.webhookSecret ?? `whsec_${randomBytes(16).toString("hex")}`,
    webhookUrl: opts.webhookUrl ?? "http://127.0.0.1:9/webhook",
    publicBaseUrl: opts.publicBaseUrl ?? "",
    accountName: opts.accountName ?? "YourTal",
  };
  assertPaySimAllowed(config.appEnv);
  const store = opts.store ?? createMemoryPaySimStore();
  const app = Fastify({ logger: false });
  const now = opts.now ?? (() => new Date());
  await registerPaySim(app, { prefix: "", store, config, now });
  await app.listen({ host: "127.0.0.1", port: opts.port ?? 0 });
  const address = app.server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  if (config.publicBaseUrl === "") config.publicBaseUrl = baseUrl;

  return {
    baseUrl,
    secretKey: config.secretKey,
    webhookSecret: config.webhookSecret,
    config,
    store,
    tick: () =>
      runPaySimTick({
        store,
        config,
        now,
        ...(opts.fetch === undefined ? {} : { fetch: opts.fetch }),
      }),
    close: () => app.close(),
  };
}
