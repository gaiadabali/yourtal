import { Pool } from "pg";

/**
 * Refuses to let the API run as a Postgres superuser. YT-0554, risk 45.
 *
 * Every grant boundary in this schema was correct, tested and documented —
 * `REVOKE ALL ON SCHEMA ledger FROM yourtal_app`, `ledger.daily_proof`
 * INSERT/SELECT only so a day can be proved exactly once, append-only
 * entries, a `campaign.terms_version` the app cannot rewrite. The only
 * thing wrong was which connection string the app used: `.env` pointed
 * `DATABASE_URL` at `yourtal`, which is `rolsuper` + `rolbypassrls`.
 *
 * A superuser ignores every one of those grants, and `BYPASSRLS` means
 * row-level security will not apply the moment it is added. So the whole
 * design was decorative at runtime while the test suite stayed green —
 * because the suite connects as `yourtal_app` and the running app did not.
 *
 * That is the docs/13c pattern in its most expensive shape: not a gate that
 * fails to check, but a control that was built, tested, and then not used.
 * A green suite actively argues against you finding it.
 *
 * Hence a boot assertion rather than a comment or a code review rule. This
 * is the same shape the driver seam uses for `live` without a credential
 * (YT-0535): refuse to start, rather than start and be wrong, because a
 * silent fallback in production is indistinguishable from working.
 */
export class PrivilegedDatabaseRoleError extends Error {
  constructor(role: string, attributes: readonly string[]) {
    super(
      `Refusing to start: the database role "${role}" has ${attributes.join(" and ")}. ` +
        `The API must connect as an unprivileged role (yourtal_app) so that the schema's ` +
        `GRANT/REVOKE boundaries actually apply — a superuser silently ignores all of them, ` +
        `and BYPASSRLS disables row-level security. Point DATABASE_URL at yourtal_app and ` +
        `leave the owner credential in DATABASE_OWNER_URL, which only migrations use. ` +
        `See YT-0554 and risk 45.`,
    );
    this.name = "PrivilegedDatabaseRoleError";
  }
}

/**
 * Asks Postgres what the connection's own role may do, rather than parsing
 * the URL for a username. A username tells you what someone typed; the
 * catalogue tells you what the server will actually permit, which is the
 * thing that matters and the thing that can drift.
 */
export async function assertUnprivilegedRole(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const result = await pool.query<{
      role: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      `select current_user as role, rolsuper, rolbypassrls
         from pg_roles
        where rolname = current_user`,
    );

    const row = result.rows[0];
    if (row === undefined) {
      // current_user always has a pg_roles entry; if it does not, something
      // is wrong enough that guessing is worse than refusing.
      throw new Error(
        "Refusing to start: could not determine the database role's privileges (YT-0554).",
      );
    }

    const attributes: string[] = [];
    if (row.rolsuper) attributes.push("SUPERUSER");
    if (row.rolbypassrls) attributes.push("BYPASSRLS");

    if (attributes.length > 0) {
      throw new PrivilegedDatabaseRoleError(row.role, attributes);
    }
  } finally {
    await pool.end();
  }
}
