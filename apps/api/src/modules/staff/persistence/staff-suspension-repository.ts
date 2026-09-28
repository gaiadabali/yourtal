import type { Pool } from "pg";

export const STAFF_SUSPENSION_REPOSITORY = Symbol("STAFF_SUSPENSION_REPOSITORY");

export interface OpenSuspension {
  readonly id: string;
  /** `null` when this suspension escrowed nothing -- a zero-balance account. */
  readonly escrowId: string | null;
  readonly points: number;
}

/**
 * `staff.user_suspension` (20260928120000): which ledger escrow a suspension
 * moved a user's points into, so `release` can find it again -- the ledger
 * client has no "active escrow for this user" query of its own.
 */
export interface StaffSuspensionRepository {
  /** `null` if this user has no OPEN suspension right now. */
  findOpenByUser(userId: string): Promise<OpenSuspension | null>;
  record(entry: {
    readonly userId: string;
    readonly escrowId: string | null;
    readonly points: number;
    readonly reason: string;
    readonly suspendedBy: string;
  }): Promise<void>;
  markReleased(id: string, releasedBy: string): Promise<void>;
}

export class PostgresStaffSuspensionRepository implements StaffSuspensionRepository {
  constructor(private readonly pool: Pool) {}

  async findOpenByUser(userId: string): Promise<OpenSuspension | null> {
    const result = await this.pool.query<{
      id: string;
      escrow_id: string | null;
      points: string;
    }>(
      `SELECT id, escrow_id, points FROM staff.user_suspension
        WHERE user_id = $1 AND released_at IS NULL`,
      [userId],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : { id: row.id, escrowId: row.escrow_id, points: Number(row.points) };
  }

  async record(entry: {
    readonly userId: string;
    readonly escrowId: string | null;
    readonly points: number;
    readonly reason: string;
    readonly suspendedBy: string;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO staff.user_suspension (user_id, escrow_id, points, reason, suspended_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [entry.userId, entry.escrowId, entry.points, entry.reason, entry.suspendedBy],
    );
  }

  async markReleased(id: string, releasedBy: string): Promise<void> {
    await this.pool.query(
      `UPDATE staff.user_suspension SET released_at = now(), released_by = $2 WHERE id = $1`,
      [id, releasedBy],
    );
  }
}
