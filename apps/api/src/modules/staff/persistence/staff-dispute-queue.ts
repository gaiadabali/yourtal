import type { Pool } from "pg";
import type { Region } from "@yourtal/contracts/region";
import type { DisputeReason } from "@yourtal/contracts/checkout/dispute";

export const STAFF_DISPUTE_QUEUE = Symbol("STAFF_DISPUTE_QUEUE");

export interface QueuedDispute {
  readonly voucherId: string;
  readonly sagaId: string;
  readonly userId: string;
  readonly region: Region | null;
  readonly reason: DisputeReason;
  readonly createdAt: Date;
}

const QUEUE_LIMIT = 100;

/**
 * TASKS.md 9.4.d, K13: `checkout.dispute` (4.7.c) where `outcome = 'queued'`
 * -- a captured voucher the merchant would not honour, waiting for staff.
 * Own narrow read over checkout's table, not an edit to that module: same
 * convention `staff-user-directory.ts` and 7.6/7.7 follow. List-only --
 * resolving one is 10.5.
 */
export interface StaffDisputeQueue {
  list(region?: Region): Promise<readonly QueuedDispute[]>;
}

export class PostgresStaffDisputeQueue implements StaffDisputeQueue {
  constructor(private readonly pool: Pool) {}

  async list(region?: Region): Promise<readonly QueuedDispute[]> {
    const result = await this.pool.query<{
      voucher_id: string;
      saga_id: string;
      user_id: string;
      region: string | null;
      reason: string;
      created_at: Date;
    }>(
      // 10.5.b: a voucher with a staff.dispute_resolution row has been
      // resolved -- checkout.dispute.outcome never changes to reflect that
      // (that table is append-only, 4.7.c's own design), so the exclusion
      // lives here instead.
      `SELECT d.voucher_id, d.saga_id, d.user_id, up.region, d.reason, d.created_at
         FROM checkout.dispute d
         LEFT JOIN identity.user_profile up ON up.user_id = d.user_id::text
         LEFT JOIN staff.dispute_resolution sr ON sr.voucher_id = d.voucher_id
        WHERE d.outcome = 'queued' AND sr.voucher_id IS NULL
          AND ($1::text IS NULL OR up.region = $1)
        ORDER BY d.created_at ASC
        LIMIT ${String(QUEUE_LIMIT)}`,
      [region ?? null],
    );
    return result.rows.map((row) => ({
      voucherId: row.voucher_id,
      sagaId: row.saga_id,
      userId: row.user_id,
      region: row.region as Region | null,
      reason: row.reason as DisputeReason,
      createdAt: row.created_at,
    }));
  }
}
