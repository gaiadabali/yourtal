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
 */

const HOST = process.env.PGHOST_OVERRIDE ?? "127.0.0.1:26432";

/** The application role: no ledger, no voucher writes, no key custody. */
export const APP_URL = `postgres://yourtal_app:app_local_only@${HOST}/yourtal`;

/** The owner. Migrations and fixtures only — never an application path. */
export const OWNER_URL =
  process.env.DATABASE_OWNER_URL ?? `postgres://yourtal:yourtal_local_only@${HOST}/yourtal`;

/** The ledger's own credential: the sole writer of balances. */
export const LEDGER_URL = `postgres://yourtal_ledger:ledger_local_only@${HOST}/yourtal`;

/** The voucher service's credential: the sole minter and mutator of vouchers. */
export const VOUCHER_URL = `postgres://yourtal_voucher:voucher_local_only@${HOST}/yourtal`;
