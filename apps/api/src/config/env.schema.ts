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

  /**
   * Valkey (Redis-compatible), YT-0540 — server-side session lookup and the
   * login throttle counters (account and source, kept separately). Already
   * named in `.env.example`/`.env` ("sessions, rate limits, checkpoint
   * nonces, price locks, idempotency claims") and already running in
   * `docker-compose.yml` (`--save "" --appendonly no`); this is the first
   * consumer that actually connects.
   *
   * Given a DEFAULT, deliberately, unlike `DATABASE_URL` and
   * `CHECKPOINT_TOKEN_SECRET`: this is a loopback sidecar address, the same
   * shape as `PDP_BASE_URL` above, not a secret or a credential. There is no
   * password on the local Valkey instance to leak by defaulting this, and a
   * missing Valkey fails at the first real command (a `PING` on boot would
   * be the more thorough check, and is not this ticket's to add) rather
   * than by silently keeping a private in-process counter — the failure
   * mode a per-process fallback would produce is wrong answers, not a
   * refusal to boot, which is worse.
   */
  REDIS_URL: z.url().default("redis://127.0.0.1:26379"),

  /**
   * TASKS.md 1.2.d. `fake` runs `FakeLedgerClient`/`FakeVoucherClient`
   * against `platform.{ledger,voucher}_fake_*` — real semantics, no network
   * call. `live` calls the real services over HTTP, signed with
   * `LEDGER_SERVICE_SECRET`. Defaults to `fake`; 4.9.e is what refuses
   * `fake` once `APP_ENV=staging`.
   */
  LEDGER_MODE: z.enum(["fake", "live"]).default("fake"),
  /** Only read when `LEDGER_MODE=live`. Loopback service name, never a public URL. */
  LEDGER_BASE_URL: z.url().default("http://127.0.0.1:26910"),
  /**
   * The HMAC secret api and worker sign ledger calls with
   * (services/ledger/internal/serviceauth, 4.1.a). At least 32 bytes, the
   * ledger's own minimum. The default is the local stack's, never a real one.
   */
  LEDGER_SERVICE_SECRET: z.string().min(32).default("local-only-ledger-service-secret-not-real"),
  /**
   * Signs completed reward sessions (4.4.c): the ledger pays a campaign reward
   * only on a completion it verifies with the same secret. At least 32 bytes.
   */
  REWARD_ATTESTATION_SECRET: z
    .string()
    .min(32)
    .default("local-only-reward-attestation-secret-not-real"),
  /** Only read when `LEDGER_MODE=live` (`VoucherInternalClient` shares the same switch). */
  VOUCHER_BASE_URL: z.url().default("http://voucher:8080"),

  /**
   * Feature flag: whether a 13-17-year-old may register at all, with
   * parental consent (1.4.b, F4 — reverses the old C4 default). Default
   * `false` EVERYWHERE, deliberately not opt-out: this reaches minors, and
   * only 12.1 switches it on, for staging only, pending counsel review
   * (12.4). With it off, `AuthService` refuses anyone under 18 outright, the
   * same way it always has.
   *
   * `z.enum(["true","false"])`, not `z.coerce.boolean()`: coercion makes
   * ANY non-empty string truthy, including the literal string `"false"` —
   * exactly the typo-becomes-silently-on shape `driver-mode.ts` refuses for
   * the same reason (`DriverMode` is `z.enum`, never `z.coerce.boolean()`).
   * A flag reaching minors is not the place to relax that.
   */
  TEEN_ACCOUNTS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),

  /**
   * The deployment environment, distinct from `NODE_ENV` (the JS runtime
   * mode) — `apps/web/features/shell/app-env.ts` already reads the same
   * variable this way for the staging banner (3.1.f) and `2.3.a`'s boot
   * checks. 1.6.b's `/api/dev/inbox` reads it too: enabled for `dev` and
   * `staging`, refused in `production` — a reviewer's own inbox is not a
   * page a real deployment serves.
   */
  APP_ENV: z.enum(["dev", "staging", "production"]).default("dev"),
});

export type Env = z.infer<typeof envSchema>;
