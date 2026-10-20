import type pg from "pg";
import type { DomainHandler, HandlerRegistry } from "@yourtal/consent/dsar-orchestrator";

/**
 * Deletion handlers for the personal tables that had none (group 1.20): the
 * `me` schema, the account-security tokens, a person's seat in an
 * organisation, and watch sessions.
 *
 * ## Why most of them call a function
 *
 * `yourtal_app` holds no DELETE on most of these tables, and it should not:
 * DELETE on a notification or a watch session is also "rewrite what the user
 * did". Each handler calls a SECURITY DEFINER function in `platform` (see
 * migration 20261020150604), which deletes rows for the one subject it is
 * given and nothing else, as `platform.forget_partner_subject` does. The
 * handlers run as the app and the app's grants stay as they were.
 *
 * Each one is idempotent: a second run finds nothing, deletes nothing and
 * returns 0, and the orchestrator reports the same status.
 */

function callErase(pool: pg.Pool, fn: string): DomainHandler {
  return async (subjectId: string): Promise<number> => {
    const { rows } = await pool.query<{ erased: number }>(`SELECT ${fn}($1) AS erased`, [
      subjectId,
    ]);
    return rows[0]?.erased ?? 0;
  };
}

/** `me.*` (except `link_code`, which `partner_links` deletes) and `feed.demotion`. */
export function eraseMeData(pool: pg.Pool): DomainHandler {
  return callErase(pool, "platform.erase_me_subject");
}

/** `charity.member` and the team invitation the subject accepted. */
export function eraseOrgMemberships(pool: pg.Pool): DomainHandler {
  return callErase(pool, "platform.erase_org_memberships");
}

/** Sessions, coverage, checkpoint nonces and issues, and checkpoint answers. */
export function eraseWatchSessions(pool: pg.Pool): DomainHandler {
  return callErase(pool, "platform.erase_watch_subject");
}

/**
 * Pending verification and password-reset tokens, and the recovery freeze.
 * The app already holds DELETE on both (they are the app's own tables), so
 * this is a plain DELETE with no function. One statement each, and a token
 * row for a subject that never had one is just `rowCount: 0`.
 */
export function eraseAccountSecurity(pool: pg.Pool): DomainHandler {
  return async (subjectId: string): Promise<number> => {
    const tokens = await pool.query(`DELETE FROM identity.verification_token WHERE user_id = $1`, [
      subjectId,
    ]);
    const frozen = await pool.query(
      `DELETE FROM identity.principal_security_state WHERE user_id = $1`,
      [subjectId],
    );
    return (tokens.rowCount ?? 0) + (frozen.rowCount ?? 0);
  };
}

export function meHandlers(pool: pg.Pool): HandlerRegistry {
  return {
    me_data: eraseMeData(pool),
    account_security: eraseAccountSecurity(pool),
    org_memberships: eraseOrgMemberships(pool),
    watch_sessions: eraseWatchSessions(pool),
  };
}
