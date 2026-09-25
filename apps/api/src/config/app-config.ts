import { envSchema } from "./env.schema";
import type { Env } from "./env.schema";

/**
 * The shape every provider in this app injects. Deliberately narrower than
 * `Env` in naming (camelCase, grouped) — `Env` is the wire format from the
 * process; `AppConfig` is what application code should think in terms of.
 */
export interface AppConfig {
  readonly nodeEnv: Env["NODE_ENV"];
  readonly port: number;
  readonly pdp: {
    readonly baseUrl: string;
    readonly timeoutMs: number;
  };
  /** Required since YT-0552 — there is no in-memory fallback to select. */
  readonly databaseUrl: string;
  /** Valkey (YT-0540) — sessions and login throttle counters. */
  readonly redisUrl: string;
  /** TASKS.md 1.2.d — `LedgerInternalClient`/`VoucherInternalClient`'s fake-vs-live switch. */
  readonly ledger: {
    readonly mode: Env["LEDGER_MODE"];
    readonly baseUrl: string;
    readonly voucherBaseUrl: string;
  };
}

/**
 * `process.env` is read in exactly this one file (docs/13b section 7). Every
 * other file that needs configuration takes `AppConfig` through DI.
 */
export function loadAppConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const env = envSchema.parse(source);

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    pdp: {
      baseUrl: env.PDP_BASE_URL,
      timeoutMs: env.PDP_TIMEOUT_MS,
    },
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    ledger: {
      mode: env.LEDGER_MODE,
      baseUrl: env.LEDGER_BASE_URL,
      voucherBaseUrl: env.VOUCHER_BASE_URL,
    },
  };
}
