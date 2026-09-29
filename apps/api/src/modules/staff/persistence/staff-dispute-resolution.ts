import type { Pool } from "pg";

export const STAFF_DISPUTE_RESOLUTION = Symbol("STAFF_DISPUTE_RESOLUTION");

/**
 * TASKS.md 10.5.b: recording a K13 dispute's resolution, and finding the
 * capture id `recoverCapture` needs — `checkout.dispute` only ever names a
 * voucherId/sagaId (4.7.c), and the ledger's recovery route is keyed on the
 * capture instead. Own narrow SQL over `voucher.authorization`/
 * `voucher.capture` (yourtal_app has SELECT on both, 20260920000016), not
 * an edit to the voucher module — same convention staff-dispute-queue.ts's
 * own header states.
 */
export interface StaffDisputeResolution {
  /** The most recent capture against this voucher, or null if it was never captured. */
  findCaptureIdForVoucher(voucherId: string): Promise<string | null>;
  record(entry: {
    readonly voucherId: string;
    readonly captureId: string;
    readonly recoveryPostingId: string;
    readonly resolvedBy: string;
    readonly resolutionNote: string;
  }): Promise<void>;
}

export class PostgresStaffDisputeResolution implements StaffDisputeResolution {
  constructor(private readonly pool: Pool) {}

  async findCaptureIdForVoucher(voucherId: string): Promise<string | null> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT c.id::text AS id
         FROM voucher.authorization a
         JOIN voucher.capture c ON c.authorization_id = a.id
        WHERE a.voucher_id = $1
        ORDER BY c.created_at DESC
        LIMIT 1`,
      [voucherId],
    );
    return result.rows[0]?.id ?? null;
  }

  async record(entry: {
    readonly voucherId: string;
    readonly captureId: string;
    readonly recoveryPostingId: string;
    readonly resolvedBy: string;
    readonly resolutionNote: string;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO staff.dispute_resolution
         (voucher_id, capture_id, recovery_posting_id, resolved_by, resolution_note)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        entry.voucherId,
        entry.captureId,
        entry.recoveryPostingId,
        entry.resolvedBy,
        entry.resolutionNote,
      ],
    );
  }
}
