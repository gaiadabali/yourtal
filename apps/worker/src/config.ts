import { z } from "zod";

/**
 * The one Zod-parsed config object for this app (docs/13b section 7), same
 * convention as `apps/api/src/config/env.schema.ts` — every variable this
 * process reads is declared here, once, so a missing one fails fast at boot.
 *
 * `DATABASE_URL` has no default, same reasoning as the API's: a fallback is
 * the thing a test quietly selects, and a worker silently pointed at the
 * wrong database would run real job side effects against it.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  // The ledger's loopback address and the shared service-auth secret, with
  // the same dev defaults as apps/api's.
  LEDGER_BASE_URL: z.url().default("http://127.0.0.1:26910"),
  LEDGER_SERVICE_SECRET: z.string().min(32).default("local-only-ledger-service-secret-not-real"),
  // TASKS.md 11.5.h: same switch as apps/api's own `LEDGER_MODE`
  // (env.schema.ts) — one env var, read by both processes. `streak-backstop`
  // is the only job that currently branches on it (it writes a grant
  // itself, unlike the read-only release/expiry jobs above).
  LEDGER_MODE: z.enum(["fake", "live"]).default("fake"),
  // TASKS.md 8.3.e: same loopback pattern as the ledger's above, for
  // services/voucher/internal/serviceauth — the worker drains its webhook
  // outbox from here. Same env var names and defaults apps/api's
  // env.schema.ts already declares (both processes read one shared .env).
  VOUCHER_BASE_URL: z.url().default("http://voucher:8080"),
  VOUCHER_SERVICE_SECRET: z.string().min(32).default("local-only-voucher-service-secret-not-real"),
  // TASKS.md 8.3.c: the same key apps/api seals a webhook's own signing
  // secret under (env.schema.ts) — this job has to recover it to sign each
  // delivery, so both processes read one shared key, never two.
  WEBHOOK_SECRET_ENCRYPTION_KEY: z
    .string()
    .min(32)
    .default("local-only-webhook-secret-encryption-key-not-a-real-secret"),
  // TASKS.md 10.4.c (EW-18): where nginx's own access log lives on this
  // box. Empty by default -- dev and CI have no nginx in front of them, and
  // `delivery-log-ingest.ts` treats "" as "nothing to ingest yet" rather
  // than failing; staging's `.gaiadeploy.yml` sets the real path.
  NGINX_ACCESS_LOG_PATH: z.string().default(""),
});

export interface WorkerConfig {
  readonly nodeEnv: "development" | "test" | "production";
  readonly databaseUrl: string;
  readonly ledger: {
    readonly baseUrl: string;
    readonly serviceSecret: string;
    readonly mode: "fake" | "live";
  };
  readonly voucher: { readonly baseUrl: string; readonly serviceSecret: string };
  readonly webhookSecretEncryptionKey: string;
  readonly nginxAccessLogPath: string;
}

/** `process.env` is read in exactly this one file. Everything else takes `WorkerConfig`. */
export function loadWorkerConfig(source: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const env = envSchema.parse(source);
  return {
    nodeEnv: env.NODE_ENV,
    databaseUrl: env.DATABASE_URL,
    ledger: {
      baseUrl: env.LEDGER_BASE_URL,
      serviceSecret: env.LEDGER_SERVICE_SECRET,
      mode: env.LEDGER_MODE,
    },
    voucher: { baseUrl: env.VOUCHER_BASE_URL, serviceSecret: env.VOUCHER_SERVICE_SECRET },
    webhookSecretEncryptionKey: env.WEBHOOK_SECRET_ENCRYPTION_KEY,
    nginxAccessLogPath: env.NGINX_ACCESS_LOG_PATH,
  };
}
