import { describe, expect, it } from "vitest";
import { PrivilegedDatabaseRoleError, assertUnprivilegedRole } from "./assert-unprivileged-role";

/**
 * YT-0554 / risk 45 — the assertion that keeps the schema's grants from
 * being decorative at runtime.
 *
 * Both URLs are built here rather than read from `DATABASE_URL` /
 * `DATABASE_OWNER_URL` directly, and that is deliberate. `vitest.config.ts`
 * sets `env.DATABASE_URL`, and a value set there OVERRIDES one passed on the
 * command line — which is YT-0558, and is exactly how a sabotage in this
 * repo came back green while the database was pointed at a dead host the
 * whole run. A test whose subject is "which role are we connected as" must
 * not take that role from a channel something else can silently win.
 *
 * `TEST_DATABASE_NAME` is that channel instead: `with-test-db.mjs` sets it
 * and nothing in this package's `vitest.config.ts` touches or overrides it,
 * so it carries no override risk while still pointing at THIS run's
 * `yourtal_test_*` database rather than a hard-coded dev one (YT-0571) — role
 * privileges (SUPERUSER, BYPASSRLS) are cluster-wide, so which database this
 * connects to does not change what the test proves, only whether a run
 * outside `pnpm test` touches dev data at all.
 *
 * The credentials themselves stay literal because they are local-only
 * docker-compose passwords, identical to the ones in `docker-compose.yml`
 * and `packages/db/src/database-urls.ts`. Deployed environments take both
 * from Secret Manager (YT-0026).
 */
const HOST = process.env["PGHOST_OVERRIDE"] ?? "127.0.0.1:26432";
const DB_NAME = process.env["TEST_DATABASE_NAME"];
if (DB_NAME === undefined || !DB_NAME.startsWith("yourtal_test_")) {
  throw new Error(
    `TEST_DATABASE_NAME is not a yourtal_test_* database (got ${JSON.stringify(DB_NAME)}) — ` +
      "run this suite via `pnpm --filter @yourtal/api test`.",
  );
}
const APP_URL = `postgres://yourtal_app:app_local_only@${HOST}/${DB_NAME}`;
const OWNER_URL = `postgres://yourtal:yourtal_local_only@${HOST}/${DB_NAME}`;

describe("assertUnprivilegedRole", () => {
  it("accepts the application role", async () => {
    await expect(assertUnprivilegedRole(APP_URL)).resolves.toBeUndefined();
  });

  /**
   * The break-it half. Before this ticket the running app used exactly this
   * URL, so this test failing open would restore the original bug silently.
   */
  it("refuses the owner, which is SUPERUSER and BYPASSRLS", async () => {
    await expect(assertUnprivilegedRole(OWNER_URL)).rejects.toBeInstanceOf(
      PrivilegedDatabaseRoleError,
    );
  });

  it("names both offending attributes, so the message says what to fix", async () => {
    const error = await assertUnprivilegedRole(OWNER_URL).catch((e: unknown) => e);
    expect(String(error)).toContain("SUPERUSER");
    expect(String(error)).toContain("BYPASSRLS");
    expect(String(error)).toContain("yourtal_app");
  });
});
