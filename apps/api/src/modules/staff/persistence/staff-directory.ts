import type { Pool } from "pg";

export const STAFF_DIRECTORY = Symbol("STAFF_DIRECTORY");

export interface StaffDirectory {
  /** The sign-in email of a staff member, for the console's own header. */
  emailOf(userId: string): Promise<string | null>;
}

/** Reads `identity.credential` directly, the same "own narrow query" convention 7.6 and 7.7 use. */
export class PostgresStaffDirectory implements StaffDirectory {
  constructor(private readonly pool: Pool) {}

  async emailOf(userId: string): Promise<string | null> {
    const result = await this.pool.query<{ identifier: string }>(
      `SELECT identifier FROM identity.credential WHERE user_id = $1 AND kind = 'password' LIMIT 1`,
      [userId],
    );
    return result.rows[0]?.identifier ?? null;
  }
}
