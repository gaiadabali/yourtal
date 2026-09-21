import { z } from "zod";

/**
 * The one Zod-parsed config object (docs/13b section 7). Every field this
 * app reads from the environment is declared here, once, so a missing or
 * malformed variable fails fast at boot rather than as a runtime `undefined`
 * three layers deep in a use-case.
 *
 * `DATABASE_URL` is REQUIRED as of YT-0552, and that change is the ticket.
 *
 * It was optional, and `business.module.ts` wired in-memory repositories
 * when it was absent. The effect was that the API booted, seven controllers
 * responded, every test passed — and **nothing ever executed a line of SQL**.
 * Every Drizzle query and every schema constraint was typechecked and never
 * run: the green-but-empty shape in `docs/13c`, sitting under the whole
 * backend rather than under one gate.
 *
 * A fallback is the thing tests quietly select. Making the variable required
 * means a misconfigured deployment fails at boot instead of silently serving
 * an in-memory fake — the same rule the driver seam enforces for `live`
 * without a credential (YT-0535), and for the same reason: a silent fallback
 * is indistinguishable from working until it matters.
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

  /** Required. See the doc comment above for why this is not optional. */
  DATABASE_URL: z.url(),

  /**
   * Signs checkpoint tokens (YT-0121). Required, with no default, and the
   * absence of a default is the point.
   *
   * `DATABASE_URL`'s argument above is that a fallback is the thing tests
   * quietly select. For a signing key it is worse than that: a default
   * committed here is a key every reader of this repository holds, so every
   * environment that forgot to set one issues checkpoint tokens that anybody
   * can forge — and a forged checkpoint token is a claim to have been
   * present for a segment of video nobody watched.
   *
   * `.min(32)` because a short key is a guessable one, and a boot that
   * accepts `"secret"` has checked a box rather than a key.
   */
  CHECKPOINT_TOKEN_SECRET: z.string().min(32),
});

export type Env = z.infer<typeof envSchema>;
