import type { Pool } from "pg";
import type { OidcAccount } from "./claims";
import type { Region } from "./clients";

/** What a person shares with an app now (`oidc.app_consent`). */
export interface AppConsent {
  readonly scopes: readonly string[];
  readonly policyVersionId: string;
  readonly grantedVia: "consent_screen" | "guardian_invite";
  readonly endedAt: Date | null;
}

export interface GrantAppConsent {
  readonly userId: string;
  readonly sector: string;
  readonly scopes: readonly string[];
  readonly policyVersionId: string;
  readonly jurisdiction: Region;
  readonly now: Date;
}

/** Everything the provider reads and writes outside its own adapter records. */
export interface OidcStore {
  findAccount(userId: string): Promise<OidcAccount | null>;
  /** The person's pairwise sub for this sector, made on first use from `fresh()`. */
  subjectFor(sector: string, userId: string, fresh: () => string): Promise<string>;
  findAppConsent(userId: string, sector: string): Promise<AppConsent | null>;
  /** The current consent and its append-only evidence, in one transaction. */
  grantAppConsent(input: GrantAppConsent): Promise<void>;
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

    async findAppConsent(userId, sector) {
      const result = await pool.query<{
        scopes: string[];
        policy_version_id: string;
        granted_via: AppConsent["grantedVia"];
        ended_at: Date | null;
      }>(
        `SELECT scopes, policy_version_id, granted_via, ended_at
           FROM oidc.app_consent WHERE user_id = $1 AND sector = $2`,
        [userId, sector],
      );
      const row = result.rows[0];
      if (row === undefined) return null;
      return {
        scopes: row.scopes,
        policyVersionId: row.policy_version_id,
        grantedVia: row.granted_via,
        endedAt: row.ended_at,
      };
    },

    async grantAppConsent(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO oidc.app_consent
             (user_id, sector, scopes, policy_version_id, granted_via, granted_at)
           VALUES ($1, $2, $3, $4, 'consent_screen', $5)
           ON CONFLICT (user_id, sector) DO UPDATE SET
             scopes = EXCLUDED.scopes,
             policy_version_id = EXCLUDED.policy_version_id,
             granted_via = EXCLUDED.granted_via,
             invite_id = NULL,
             granted_at = EXCLUDED.granted_at,
             ended_at = NULL,
             end_reason = NULL`,
          [input.userId, input.sector, input.scopes, input.policyVersionId, input.now],
        );
        await client.query(
          `INSERT INTO identity.consent_record
             (user_id, purpose, jurisdiction, policy_version_id, state, recorded_at, source, audience)
           VALUES ($1, 'sister_app_profile_sharing', $2, $3, 'granted', $4, 'oidc_consent_screen', $5)`,
          [input.userId, input.jurisdiction, input.policyVersionId, input.now, input.sector],
        );
        await client.query("COMMIT");
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
