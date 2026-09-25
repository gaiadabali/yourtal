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
});

export interface WorkerConfig {
  readonly nodeEnv: "development" | "test" | "production";
  readonly databaseUrl: string;
  readonly ledger: { readonly baseUrl: string; readonly serviceSecret: string };
}

/** `process.env` is read in exactly this one file. Everything else takes `WorkerConfig`. */
export function loadWorkerConfig(source: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const env = envSchema.parse(source);
  return {
    nodeEnv: env.NODE_ENV,
    databaseUrl: env.DATABASE_URL,
    ledger: { baseUrl: env.LEDGER_BASE_URL, serviceSecret: env.LEDGER_SERVICE_SECRET },
  };
}
