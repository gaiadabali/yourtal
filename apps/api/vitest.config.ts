import { configDefaults, defineConfig } from "vitest/config";

/**
 * `apps/api`'s tests talk to the real Postgres and the real Cerbos from
 * `docker-compose`. YT-0527 wired the PDP; YT-0552 wired the database.
 */
export default defineConfig({
  test: {
    // `.contract.spec.ts` is 1.2.e's own naming (`ledger-client.contract.spec.ts`,
    // `voucher-client.contract.spec.ts`) — run against the fake today, against
    // the live services once 4.1/4.5 land.
    include: ["src/**/*.test.ts", "src/**/*.contract.spec.ts"],
    // `*.live.test.ts` needs the live services and runs only through its own
    // script (scripts/checkout-live.mjs sets CHECKOUT_LIVE=1). Left in the
    // default run it only ever reports "skipped", which Integration rightly
    // refuses to treat as a pass.
    exclude:
      process.env.CHECKOUT_LIVE === "1"
        ? configDefaults.exclude
        : [...configDefaults.exclude, "src/**/*.live.test.ts"],
    environment: "node",
    passWithNoTests: false,
    // YT-0571: refuses to run this suite against anything but a
    // yourtal_test_* database — see packages/db/scripts/assert-test-database.mjs.
    // Runs AFTER `env` below is applied (setupFiles execute inside the
    // worker, post `test.env`), so it sees the same DATABASE_URL the tests
    // themselves get — including the literal fallback right below, which is
    // exactly what it exists to catch when nothing set the real one.
    setupFiles: ["../../packages/db/scripts/assert-test-database.mjs"],

    /**
     * The app role, not the owner — so a missing grant fails here rather
     * than in production. Supplied here as a FALLBACK ONLY, not an
     * assignment, because `app.boot.test.ts` boots the real `AppModule`,
     * which reads `process.env` directly, and a suite that only passes on a
     * machine that happens to have the variable is one that will fail in CI
     * for a reason nobody can reproduce locally.
     *
     * `DATABASE_URL` is required by `env.schema.ts` as of YT-0552. It used
     * to be optional, and the module fell back to in-memory repositories
     * when it was missing — so the whole backend ran, and its tests passed,
     * without a line of SQL ever executing.
     *
     * YT-0558: this used to be a bare assignment, `DATABASE_URL: "postgres://…"`,
     * which Vitest's `test.env` applies unconditionally — it OVERWRITES a
     * value already sitting in `process.env`, including one passed on the
     * command line specifically to redirect the connection. That silently
     * defeated the one way anyone has to prove this suite really talks to a
     * database (point `DATABASE_URL` at a dead host and expect red): the
     * override made it come back green regardless. Reading
     * `process.env.DATABASE_URL` first and falling back to the literal only
     * when it is unset restores the command line's ability to win.
     */
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ?? "postgres://yourtal_app:app_local_only@127.0.0.1:26432/yourtal",

      /**
       * Added for YT-0121 at the checkpoint-token work's request, and it
       * goes in BEFORE `env.schema.ts` makes it required — otherwise every
       * suite that boots `AppModule` goes red at once and four sessions see
       * a failure none of them can explain from their own work.
       *
       * Fallback form, not a bare assignment, for the reason above it: a
       * value here that OVERWRITES `process.env` cannot be redirected from
       * the command line, and that is exactly the defect YT-0558 removed.
       *
       * The literal is deliberately not a plausible key. It never leaves
       * this file, and the signing secret has NO default in
       * `env.schema.ts` — a signing key with a default is a key every
       * reader of the repository already holds, which is the
       * `DATABASE_URL` argument with the stakes raised. The tempting fix
       * when a boot fails for a missing secret is to give it a default,
       * and the default IS the vulnerability.
       *
       * DO NOT SHORTEN THIS STRING. `env.schema.ts:56` requires
       * `z.string().min(32)`. The first version of this literal was
       * exactly 32 characters — valid, with zero margin — so trimming a
       * word while tidying would have failed the schema and turned EVERY
       * `apps/api` suite that boots `AppModule` red at once, with nothing
       * in the output naming the length as the cause. Caught by another
       * session measuring it rather than reading it. It is now
       * comfortably over, matching the other three sites, and the length
       * is load-bearing rather than cosmetic.
       */
      CHECKPOINT_TOKEN_SECRET:
        process.env.CHECKPOINT_TOKEN_SECRET ??
        "vitest-only-checkpoint-signing-key-not-a-real-secret",
    },

    /**
     * YT-0547 gave this package its own database (`with-test-db.mjs`), which
     * is what makes it safe to run concurrently with `packages/db` and
     * `packages/idempotency` — proved by running them at the same time, see
     * that ticket's report. It does NOT make it safe to remove this line.
     *
     * PROVED BY BREAKING IT, not assumed: with `fileParallelism: false`
     * deleted, three separate runs against a freshly isolated database each
     * failed, 4-7 files at a time, always inside `modules/business` and
     * `modules/store` — the two places where MANY files share ONE
     * whole-table-wipe helper (`clearBusinessTables`, `clearStoreTables`),
     * each called from that file's own `beforeAll`. Two files racing to
     * "DELETE everything, then insert my fixture, then assert" on the SAME
     * table is not made safe by which database it happens in — it is the
     * cross-FILE version of the cross-PACKAGE bug this ticket exists to
     * fix, and it reproduces the ticket's own signature exactly: a
     * different file fails each run, and every one of them passes alone.
     *
     * `modules/store/**` is fenced to another session for this ticket, so
     * its seven files cannot be moved off whole-table clearing here.
     * `modules/business/**` is not fenced and shares the identical pattern
     * across thirteen files — fixing it is a real, separate piece of work
     * (scoping cleanup to rows a test itself created, the way
     * `packages/db`'s own suites already do) and is exactly the shape of
     * thing that should not be rushed into the same change that is also
     * touching how every package's tests get a database. Left serial, with
     * this now-accurate reason instead of the stale one about a single
     * shared "yourtal".
     */
    fileParallelism: false,
    testTimeout: 20_000,
    /**
     * `testTimeout` does NOT cover hooks — Vitest times those separately at
     * a 10s default, and the expensive work here is in `beforeAll`, which
     * boots a Nest application and connects a pool.
     */
    hookTimeout: 30_000,
  },
});
