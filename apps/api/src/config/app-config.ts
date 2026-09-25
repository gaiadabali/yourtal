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
  readonly rateLimitNamespace?: string;
  /** TASKS.md 1.2.d — `LedgerInternalClient`/`VoucherInternalClient`'s fake-vs-live switch. */
  readonly ledger: {
    readonly mode: Env["LEDGER_MODE"];
    readonly baseUrl: string;
    /** Signs live ledger calls; optional so test configs in fake mode need not name it. */
    readonly serviceSecret?: string;
    /** Signs reward completions (4.4.c); optional so fake-mode test configs need not name it. */
    readonly rewardAttestationSecret?: string;
    readonly voucherBaseUrl: string;
    /** services/voucher/internal/serviceauth's secret — a separate service, a separate secret. */
    readonly voucherServiceSecret: string;
  };
  /** 1.4.b, F4 — default false everywhere; only 12.1 turns it on, for staging. */
  readonly teenAccounts: boolean;
  /** 1.6.b — gates `/api/dev/inbox`. Default `"dev"`, same as `Env["APP_ENV"]`. */
  readonly appEnv: Env["APP_ENV"];
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
    rateLimitNamespace: env.RATE_LIMIT_NAMESPACE,
    ledger: {
      mode: env.LEDGER_MODE,
      baseUrl: env.LEDGER_BASE_URL,
      serviceSecret: env.LEDGER_SERVICE_SECRET,
      rewardAttestationSecret: env.REWARD_ATTESTATION_SECRET,
      voucherBaseUrl: env.VOUCHER_BASE_URL,
      voucherServiceSecret: env.VOUCHER_SERVICE_SECRET,
    },
    teenAccounts: env.TEEN_ACCOUNTS,
    appEnv: env.APP_ENV,
  };
}
