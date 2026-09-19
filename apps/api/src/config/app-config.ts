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
  /** `undefined` until YT-0022 provisions Postgres — see `env.schema.ts`. */
  readonly databaseUrl: string | undefined;
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
  };
}
