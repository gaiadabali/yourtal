import { z } from "zod";

/**
 * The one Zod-parsed config object (docs/13b section 7). Every field this
 * app reads from the environment is declared here, once, so a missing or
 * malformed variable fails fast at boot rather than as a runtime `undefined`
 * three layers deep in a use-case.
 *
 * `DATABASE_URL` is optional on purpose: YT-0022 (Postgres provisioning) is
 * blocked on GCP, so there is no live database to point this at yet. When it
 * is absent, `business.module.ts` wires the in-memory repositories instead
 * of the Drizzle ones — see that file for the swap point.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),

  /**
   * Cerbos sidecar, loopback only (docs/10, docs/15) — never a shared PDP.
   * `26592` matches `docker-compose.yml` and `.env.example`, not Cerbos's
   * own default port (`3592`) — those two used to disagree, which meant a
   * bare `pnpm dev`/`pnpm test` with no `.env` pointed at a port nothing
   * binds locally. Found while wiring YT-0527's live-PDP boot check, which
   * is what this ticket's drift test in `env.schema.test.ts` pins.
   */
  PDP_BASE_URL: z.url().default("http://127.0.0.1:26592"),
  PDP_TIMEOUT_MS: z.coerce.number().int().positive().default(500),

  /** Absent until YT-0022 provisions Postgres. See the doc comment above. */
  DATABASE_URL: z.url().optional(),
});

export type Env = z.infer<typeof envSchema>;
