import type { Pool } from "pg";
import type { Region } from "@yourtal/contracts/region";
import type { TrustTier } from "@yourtal/contracts/ledger-internal/rewards";

export const STAFF_USER_DIRECTORY = Symbol("STAFF_USER_DIRECTORY");

export interface StaffUserRow {
  readonly userId: string;
  readonly email: string | null;
  readonly region: Region;
  readonly trustTier: TrustTier;
  readonly isSuspended: boolean;
  readonly createdAt: Date;
}

// `?: T | undefined`, not just `?: T`: `exactOptionalPropertyTypes` treats
// the two differently, and the zod-inferred DTO this is fed from always has
// the wider shape (an absent field parses to `undefined`, not to an absent
// key) -- same convention `user-profile.repository.ts`'s `UserProfileUpdate`
// documents for itself.
export interface StaffUserSearch {
  readonly email?: string | undefined;
  readonly userId?: string | undefined;
  readonly region?: Region | undefined;
}

const SEARCH_LIMIT = 50;

/**
 * TASKS.md 9.4.a: reads `identity.user_profile` and `identity.credential`
 * directly, the same "own narrow query, never edit the identity module"
 * convention `staff-directory.ts` (9.1) and `apps/api/src/modules/reports`
 * (7.6/7.7) already follow -- writes go through this same class rather than
 * `UserProfileRepository`, whose `update()` only ever touches the two
 * fields `PATCH /api/me` may change, never `suspended_at` or `trust_tier`.
 */
export interface StaffUserDirectory {
  search(query: StaffUserSearch): Promise<readonly StaffUserRow[]>;
  findById(userId: string): Promise<StaffUserRow | null>;
  /** `null` if the account does not exist. */
  suspend(userId: string): Promise<Date | null>;
  /** `false` if the account was not suspended (already released, or never suspended). */
  release(userId: string): Promise<boolean>;
  /** `false` if the account does not exist. */
  setTrustTier(userId: string, tier: TrustTier): Promise<boolean>;
}

type Row = {
  readonly user_id: string;
  readonly identifier: string | null;
  readonly region: string;
  readonly trust_tier: number;
  readonly suspended_at: Date | null;
  readonly created_at: Date;
};

function toRow(row: Row): StaffUserRow {
  return {
    userId: row.user_id,
    email: row.identifier,
    region: row.region as Region,
    trustTier: row.trust_tier as TrustTier,
    isSuspended: row.suspended_at !== null,
    createdAt: row.created_at,
  };
}

export class PostgresStaffUserDirectory implements StaffUserDirectory {
  constructor(private readonly pool: Pool) {}

  async search(query: StaffUserSearch): Promise<readonly StaffUserRow[]> {
    const email = query.email === undefined ? null : query.email.trim().toLowerCase();
    const userId = query.userId ?? null;
    const region = query.region ?? null;
    const result = await this.pool.query<Row>(
      `SELECT up.user_id, c.identifier, up.region, up.trust_tier, up.suspended_at, up.created_at
         FROM identity.user_profile up
         LEFT JOIN identity.credential c ON c.user_id = up.user_id AND c.kind = 'password'
        WHERE ($1::text IS NULL OR lower(c.identifier) = $1)
          AND ($2::text IS NULL OR up.user_id = $2)
          AND ($3::text IS NULL OR up.region = $3)
        ORDER BY up.created_at DESC
        LIMIT ${String(SEARCH_LIMIT)}`,
      [email, userId, region],
    );
    return result.rows.map(toRow);
  }

  async findById(userId: string): Promise<StaffUserRow | null> {
    const result = await this.pool.query<Row>(
      `SELECT up.user_id, c.identifier, up.region, up.trust_tier, up.suspended_at, up.created_at
         FROM identity.user_profile up
         LEFT JOIN identity.credential c ON c.user_id = up.user_id AND c.kind = 'password'
        WHERE up.user_id = $1`,
      [userId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toRow(row);
  }

  async suspend(userId: string): Promise<Date | null> {
    const result = await this.pool.query<{ suspended_at: Date }>(
      `UPDATE identity.user_profile SET suspended_at = now(), updated_at = now()
        WHERE user_id = $1 AND suspended_at IS NULL
        RETURNING suspended_at`,
      [userId],
    );
    return result.rows[0]?.suspended_at ?? null;
  }

  async release(userId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE identity.user_profile SET suspended_at = NULL, updated_at = now()
        WHERE user_id = $1 AND suspended_at IS NOT NULL`,
      [userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async setTrustTier(userId: string, tier: TrustTier): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE identity.user_profile SET trust_tier = $2, updated_at = now() WHERE user_id = $1`,
      [userId, tier],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
