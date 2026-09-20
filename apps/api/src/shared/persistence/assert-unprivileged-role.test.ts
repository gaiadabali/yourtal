import { describe, expect, it } from "vitest";
import { PrivilegedDatabaseRoleError, assertUnprivilegedRole } from "./assert-unprivileged-role";

/**
 * YT-0554 / risk 45 — the assertion that keeps the schema's grants from
 * being decorative at runtime.
 *
 * Both URLs are literals here rather than read from the environment, and
 * that is deliberate. `vitest.config.ts` sets `env.DATABASE_URL`, and a
 * value set there OVERRIDES one passed on the command line — which is
 * YT-0558, and is exactly how a sabotage in this repo came back green while
 * the database was pointed at a dead host the whole run. A test whose
 * subject is "which role are we connected as" must not take that role from
 * a channel something else can silently win.
 *
 * The owner credential appears in a test file because it is a local-only
 * docker-compose password, identical to the one in `docker-compose.yml` and
 * `packages/db/src/database-urls.ts`. Deployed environments take both from
 * Secret Manager (YT-0026).
 */
const APP_URL = "postgres://yourtal_app:app_local_only@127.0.0.1:26432/yourtal";
const OWNER_URL = "postgres://yourtal:yourtal_local_only@127.0.0.1:26432/yourtal";

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
