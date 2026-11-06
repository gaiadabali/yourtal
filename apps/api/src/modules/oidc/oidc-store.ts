import type { Pool, PoolClient } from "pg";
import type { OidcAccount } from "./claims";
import type { Region } from "./clients";

/** What a person shares with an app now (`oidc.app_consent`). */
export interface AppConsent {
  readonly scopes: readonly string[];
  readonly policyVersionId: string;
  readonly grantedVia: "consent_screen" | "guardian_invite";
  /** The guardian's invite a teen's consent was given under. */
  readonly inviteId: string | null;
  readonly endedAt: Date | null;
}

export interface GrantAppConsent {
  readonly userId: string;
  readonly sector: string;
  readonly scopes: readonly string[];
  readonly policyVersionId: string;
  readonly jurisdiction: Region;
  readonly now: Date;
  /** A teen's consent, under a guardian's invite; `accept` uses a pending one up. */
  readonly invite?: { readonly id: string; readonly accept: boolean };
}

/** Everything the provider reads and writes outside its own adapter records. */
export interface OidcStore {
  findAccount(userId: string): Promise<OidcAccount | null>;
  /** The person's pairwise sub for this sector, made on first use from `fresh()`. */
  subjectFor(sector: string, userId: string, fresh: () => string): Promise<string>;
  /** The person's sub for this sector if one was ever made; never makes one. */
  findSubject(sector: string, userId: string): Promise<string | null>;
  findAppConsent(userId: string, sector: string): Promise<AppConsent | null>;
  /**
   * The current consent and its append-only evidence, in one transaction, with
   * the invite accepted in it. False, and nothing written, when the invite was
   * used, ended or expired meanwhile.
   */
  grantAppConsent(input: GrantAppConsent): Promise<boolean>;
  logSignIn(userId: string, clientId: string, result: string): Promise<void>;
}

interface AccountRow {
  user_id: string;
  display_name: string;
  region: Region;
  date_of_birth: string;
  suspended: boolean;
  email: string | null;
  email_verified: boolean;
}

const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === UNIQUE_VIOLATION
  );
}

/**
 * Locks the teen's guardian consent FOR SHARE, and is true only while it stands
 * (3.10.g). A withdrawal updates this row first (`revoke-guardian-consent`), so one
 * that races this grant either waits for it and then ends the consent it wrote, or
 * commits first and this refuses. Lock order everywhere: guardian consent, invite,
 * app consent.
 */
async function holdGuardian(client: PoolClient, teenUserId: string): Promise<boolean> {
  const locked = await client.query<{ approved_at: Date | null; revoked_at: Date | null }>(
    "SELECT approved_at, revoked_at FROM identity.guardian_consent WHERE user_id = $1 FOR SHARE",
    [teenUserId],
  );
  const row = locked.rows[0];
  return row !== undefined && row.approved_at !== null && row.revoked_at === null;
}

/**
 * Locks the invite a teen's consent is given under, so an end or a second
 * acceptance waits. A pending one is used up here, once, by this teen, while
 * still good; a standing one must be this teen's and not ended.
 */
async function holdInvite(
  client: PoolClient,
  invite: NonNullable<GrantAppConsent["invite"]>,
  input: GrantAppConsent,
): Promise<boolean> {
  const locked = await client.query<{ teen_user_id: string | null; expires_at: Date }>(
    "SELECT teen_user_id, expires_at FROM oidc.teen_invite WHERE id = $1 AND ended_at IS NULL FOR UPDATE",
    [invite.id],
  );
  const row = locked.rows[0];
  if (row === undefined) return false;
  if (!invite.accept) return row.teen_user_id === input.userId;
  if (row.teen_user_id !== null || row.expires_at.getTime() <= input.now.getTime()) return false;
  await client.query(
    "UPDATE oidc.teen_invite SET teen_user_id = $2, accepted_at = $3 WHERE id = $1",
    [invite.id, input.userId, input.now],
  );
  return true;
}

/** Raw SQL over the app role's pool. Never region-scoped: these reads are by user id. */
export function createPgOidcStore(pool: Pool): OidcStore {
  return {
    async findAccount(userId) {
      const result = await pool.query<AccountRow>(
        `SELECT p.user_id, p.display_name, p.region,
                to_char(p.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
                p.suspended_at IS NOT NULL AS suspended,
                c.identifier AS email,
                c.verified_at IS NOT NULL AS email_verified
           FROM identity.user_profile p
           LEFT JOIN identity.credential c ON c.user_id = p.user_id AND c.kind = 'password'
          WHERE p.user_id = $1`,
        [userId],
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      return {
        userId: row.user_id,
        displayName: row.display_name,
        region: row.region,
        dateOfBirth: row.date_of_birth,
        email: row.email,
        emailVerified: row.email_verified,
        suspended: row.suspended,
      };
    },

    async subjectFor(sector, userId, fresh) {
      // A clash on (sector, sub) is 1 in 2^64 even at billions of people; retry it anyway.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const result = await pool.query<{ sub: string }>(
            `WITH made AS (
               INSERT INTO oidc.subject (sector, user_id, sub) VALUES ($1, $2, $3)
               ON CONFLICT (sector, user_id) DO NOTHING
               RETURNING sub)
             SELECT sub FROM made
             UNION ALL
             SELECT sub FROM oidc.subject WHERE sector = $1 AND user_id = $2
             LIMIT 1`,
            [sector, userId, fresh()],
          );
          const sub = result.rows[0]?.sub;
          if (sub !== undefined) return sub;
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
        }
      }
      throw new Error("oidc: could not make a pairwise subject");
    },

    async findSubject(sector, userId) {
      const result = await pool.query<{ sub: string }>(
        "SELECT sub FROM oidc.subject WHERE sector = $1 AND user_id = $2",
        [sector, userId],
      );
      return result.rows[0]?.sub ?? null;
    },

    async findAppConsent(userId, sector) {
      const result = await pool.query<{
        scopes: string[];
        policy_version_id: string;
        granted_via: AppConsent["grantedVia"];
        invite_id: string | null;
        ended_at: Date | null;
      }>(
        `SELECT scopes, policy_version_id, granted_via, invite_id, ended_at
           FROM oidc.app_consent WHERE user_id = $1 AND sector = $2`,
        [userId, sector],
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      return {
        scopes: row.scopes,
        policyVersionId: row.policy_version_id,
        grantedVia: row.granted_via,
        inviteId: row.invite_id,
        endedAt: row.ended_at,
      };
    },

    async grantAppConsent(input) {
      const { invite } = input;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (
          invite !== undefined &&
          !((await holdGuardian(client, input.userId)) && (await holdInvite(client, invite, input)))
        ) {
          await client.query("ROLLBACK");
          return false;
        }
        await client.query(
          `INSERT INTO oidc.app_consent
             (user_id, sector, scopes, policy_version_id, granted_via, invite_id, granted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (user_id, sector) DO UPDATE SET
             scopes = EXCLUDED.scopes,
             policy_version_id = EXCLUDED.policy_version_id,
             granted_via = EXCLUDED.granted_via,
             invite_id = EXCLUDED.invite_id,
             granted_at = EXCLUDED.granted_at,
             ended_at = NULL,
             end_reason = NULL`,
          [
            input.userId,
            input.sector,
            input.scopes,
            input.policyVersionId,
            invite === undefined ? "consent_screen" : "guardian_invite",
            invite?.id ?? null,
            input.now,
          ],
        );
        await client.query(
          `INSERT INTO identity.consent_record
             (user_id, purpose, jurisdiction, policy_version_id, state, recorded_at, source, audience)
           VALUES ($1, 'sister_app_profile_sharing', $2, $3, 'granted', $4, $5, $6)`,
          [
            input.userId,
            input.jurisdiction,
            input.policyVersionId,
            input.now,
            invite === undefined ? "oidc_consent_screen" : "guardian_invite",
            input.sector,
          ],
        );
        await client.query("COMMIT");
        return true;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async logSignIn(userId, clientId, result) {
      await pool.query(
        "INSERT INTO oidc.sign_in_log (user_id, client_id, result) VALUES ($1, $2, $3)",
        [userId, clientId, result],
      );
    },
  };
}
