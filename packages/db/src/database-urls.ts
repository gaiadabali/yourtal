/**
 * The local connection strings, in one place.
 *
 * ## Why this file exists
 *
 * Six test files hard-coded the same two URLs, and then a seventh role
 * arrived. When `yourtal_voucher` took over writing `voucher.vouchers`
 * (YT-0142), the shared seed — which ran as `yourtal_app` — lost the grant
 * it had always had, and four test files stopped loading at once. The URLs
 * being copied around was not the cause, but it is what made the fix a sweep
 * rather than an edit.
 *
 * ## Which role does what, and why the seed is not the app
 *
 * The value path is split by role on purpose (docs/13: module boundaries
 * enforced twice, once in code and once underneath). `yourtal_app` cannot
 * write the ledger, and since YT-0142 it cannot write vouchers either — it
 * can read one, because a wallet has to render it.
 *
 * **Seeding is administration, not application work.** A seed that instead
 * collected every value-path role's grant would break again the next time a
 * role is added, and would quietly assert that the application can do things
 * it deliberately cannot. So fixtures are written as the owner and asserted
 * as the app — which is also what makes a test like "the app role cannot
 * insert a voucher" possible to write at all.
 *
 * Risk 45 — the application connecting as a superuser with BYPASSRLS, which
 * would have made every grant below enforced in tests and bypassed in
 * production — was closed by YT-0554 on 2026-09-20. Verified rather than
 * taken on report: `yourtal_app` is `rolsuper = false, rolbypassrls =
 * false`, and `.env`'s `DATABASE_URL` names it. So a grant proved by these
 * tests is now also a statement about the running app.
 *
 * ## YT-0547 — which DATABASE these roles connect to
 *
 * Every URL below used to end `/yourtal`, the one real database every
 * package's tests shared — which is exactly why `turbo run test` running
 * `@yourtal/db` and `@yourtal/api` at the same time corrupted each other's
 * rows regardless of `fileParallelism`. `packages/db/scripts/with-test-db.mjs`
 * now creates a database of its own for this package before `vitest` ever
 * starts and sets `TEST_DATABASE_NAME` to its name; these constants read
 * that and fall back to the real "yourtal" only when it is unset (running a
 * file directly, outside `pnpm test`). There is no fallback DATABASE NAME
 * invented here — "yourtal" is the one real database this file has always
 * pointed at, not a guess.
 */

const HOST = process.env.PGHOST_OVERRIDE ?? "127.0.0.1:26432";
const DB_NAME = process.env.TEST_DATABASE_NAME ?? "yourtal";

/** The application role: no ledger, no voucher writes, no key custody. */
export const APP_URL = `postgres://yourtal_app:app_local_only@${HOST}/${DB_NAME}`;

/** The owner. Migrations and fixtures only — never an application path. */
export const OWNER_URL =
  process.env.DATABASE_OWNER_URL ?? `postgres://yourtal:yourtal_local_only@${HOST}/${DB_NAME}`;

/** The ledger's own credential: the sole writer of balances. */
export const LEDGER_URL = `postgres://yourtal_ledger:ledger_local_only@${HOST}/${DB_NAME}`;

/** The voucher service's credential: the sole minter and mutator of vouchers. */
export const VOUCHER_URL = `postgres://yourtal_voucher:voucher_local_only@${HOST}/${DB_NAME}`;

/**
 * The ANALYSIS role (YT-0125). Reads per-user checkpoint answers, which
 * `yourtal_app` deliberately cannot — that missing SELECT is what makes
 * "never exposed per-user to the business" a property rather than a
 * convention.
 *
 * It exists here so the boundary can be TESTED, and for no other reason.
 * Nothing that serves an HTTP request may connect as this role: doing so
 * would dissolve the control with no schema change for anyone to notice.
 */
export const ANALYST_URL = `postgres://yourtal_analyst:analyst_local_only@${HOST}/${DB_NAME}`;
