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
  /** Optional so hand-built test configs need not name it; absent means loopback. */
  readonly host?: string;
  /** Optional for hand-built test configs; absent means every HLS request is refused. */
  readonly hlsSigningSecret?: string;
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
  /** 1.5.e, F12 "Sessions" — `SessionService`'s lifetimes, config rather than constants. */
  readonly session: {
    readonly consumerIdleTtlMs: number;
    readonly consumerAbsoluteTtlMs: number;
    readonly staffAbsoluteTtlMs: number;
  };
  /** TASKS.md 7.1.b — the presigned KYB upload's own RustFS/S3 client config. */
  readonly objectStorage: {
    readonly endpoint: string;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
    readonly bucket: string;
  };
  /** 12.1.a — builds the guardian consent email's links. See `loadAppConfig`'s own comment for the per-`APP_ENV` default. */
  readonly webOrigin: string;
  /** 5.1.e / F106 — the payment simulation. Optional so hand-built test configs need not name it. */
  readonly paysim?: {
    readonly enabled: boolean;
    readonly publicUrl: string;
    readonly webhookUrl: string;
    readonly accountName: string;
  };
  /**
   * Passkeys and authenticator-app codes. Optional so hand-built test configs
   * need not name it; absent, those routes refuse with 503.
   */
  readonly authFactors?: {
    readonly rpId: string;
    readonly rpName: string;
    readonly origins: readonly string[];
    /** Absent: authenticator apps are off on this deployment; passkeys still work. */
    readonly totpSecretKey?: string;
  };
  /** The key pair the Stripe driver and the simulation share, and the API origin the driver calls. */
  readonly stripe?: {
    readonly secretKey: string;
    readonly webhookSecret: string;
    readonly apiBase: string;
  };
  /** Group 3.9 — the OpenID Connect provider. Optional so hand-built test configs need not name it. */
  readonly oidc?: {
    readonly enabled: boolean;
    readonly issuer: string;
    readonly jwksPath: string;
    readonly clientKeysDir: string;
    /** F125: the name on each app's consent screen. */
    readonly operators: { readonly snapapp: string; readonly ftr: string };
  };
}

/**
 * `process.env` is read in exactly this one file (docs/13b section 7). Every
 * other file that needs configuration takes `AppConfig` through DI.
 */
export function loadAppConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const env = envSchema.parse(source);
  if (env.APP_ENV === "staging" && env.HLS_SIGNING_SECRET.startsWith("local-only")) {
    throw new Error("HLS_SIGNING_SECRET is the local-only default; set a real one for staging.");
  }
  if (env.APP_ENV !== "dev" && env.TOTP_SECRET_ENCRYPTION_KEY?.startsWith("local-only") === true) {
    throw new Error(
      "TOTP_SECRET_ENCRYPTION_KEY is the local-only default; set a real one outside dev, or unset it.",
    );
  }
  // 12.1.a: no static schema default (see env.schema.ts's own comment) —
  // staging's `.env` on Helios is written once and gets no new line for
  // this, so the fallback has to already be staging's real origin.
  const webOrigin =
    env.PUBLIC_WEB_ORIGIN ??
    (env.APP_ENV === "staging" ? "https://yourtal.gaiada.com" : "http://localhost:3000");
  const teenAccounts =
    env.TEEN_ACCOUNTS === undefined ? env.APP_ENV === "staging" : env.TEEN_ACCOUNTS === "true";

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    host: env.HOST,
    hlsSigningSecret: env.HLS_SIGNING_SECRET,
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
    teenAccounts,
    appEnv: env.APP_ENV,
    session: {
      consumerIdleTtlMs: env.SESSION_CONSUMER_IDLE_TTL_MS,
      consumerAbsoluteTtlMs: env.SESSION_CONSUMER_ABSOLUTE_TTL_MS,
      staffAbsoluteTtlMs: env.SESSION_STAFF_ABSOLUTE_TTL_MS,
    },
    objectStorage: {
      endpoint: env.S3_ENDPOINT,
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
      bucket: env.S3_BUCKET,
    },
    authFactors: authFactorsFrom(env, webOrigin),
    webOrigin,
    paysim: {
      enabled: env.PAYSIM_ENABLED === "true",
      publicUrl: env.PAYSIM_PUBLIC_URL ?? `http://127.0.0.1:${String(env.PORT)}/api/paysim`,
      webhookUrl:
        env.PAYSIM_WEBHOOK_URL ?? `http://127.0.0.1:${String(env.PORT)}/api/webhooks/stripe`,
      accountName: env.PAYSIM_ACCOUNT_NAME,
    },
    stripe: {
      secretKey: env.STRIPE_SECRET_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      apiBase: env.STRIPE_API_BASE,
    },
    oidc: {
      enabled: env.OIDC_ENABLED === "true",
      // F109: yourtal.gaiada.com/oidc stays the issuer in production too.
      issuer:
        env.OIDC_ISSUER ??
        (env.APP_ENV === "dev"
          ? `http://localhost:${String(env.PORT)}/oidc`
          : "https://yourtal.gaiada.com/oidc"),
      jwksPath: env.OIDC_JWKS_PATH,
      clientKeysDir: env.OIDC_CLIENT_KEYS_DIR,
      operators: { snapapp: env.OIDC_OPERATOR_SNAPAPP, ftr: env.OIDC_OPERATOR_FTR },
    },
  };
}

/** Dev only: a key every reader of this repository holds. */
const DEV_TOTP_SECRET_KEY = "local-only-totp-secret-encryption-key-not-real";

/** The relying party follows the web origin unless set; see env.schema.ts. */
function authFactorsFrom(env: Env, webOrigin: string): NonNullable<AppConfig["authFactors"]> {
  const origins = (env.WEBAUTHN_ORIGIN ?? webOrigin)
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin !== "");
  const totpSecretKey =
    env.TOTP_SECRET_ENCRYPTION_KEY ?? (env.APP_ENV === "dev" ? DEV_TOTP_SECRET_KEY : undefined);
  return {
    rpId: env.WEBAUTHN_RP_ID ?? new URL(origins[0] ?? webOrigin).hostname,
    rpName: "YourTal",
    origins,
    ...(totpSecretKey === undefined ? {} : { totpSecretKey }),
  };
}
