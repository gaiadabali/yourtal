import type { Pool } from "pg";

export const STAFF_DB_POOL = Symbol("STAFF_DB_POOL");
export const STAFF_AUDIT_REPOSITORY = Symbol("STAFF_AUDIT_REPOSITORY");

export interface StaffAuditEvent {
  readonly actorUserId: string;
  readonly actorRoles: readonly string[];
  readonly action: string;
  readonly outcome: "succeeded" | "failed";
  readonly httpStatus: number;
  readonly targetKind?: string | undefined;
  readonly targetId?: string | undefined;
  readonly region?: "AU" | "ID" | undefined;
  readonly reason?: string | undefined;
  readonly detail?: Record<string, unknown> | undefined;
  readonly requestId?: string | undefined;
}

export interface StaffAuditRepository {
  record(event: StaffAuditEvent): Promise<void>;
}

/** Raw SQL over `staff.audit_event` (20260927161630), which is append-only by trigger. */
export class PostgresStaffAuditRepository implements StaffAuditRepository {
  constructor(private readonly pool: Pool) {}

  async record(event: StaffAuditEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO staff.audit_event
         (actor_user_id, actor_roles, action, outcome, http_status,
          target_kind, target_id, region, reason, detail, request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        event.actorUserId,
        event.actorRoles,
        event.action,
        event.outcome,
        event.httpStatus,
        event.targetKind ?? null,
        event.targetId ?? null,
        event.region ?? null,
        event.reason ?? null,
        event.detail ?? {},
        event.requestId ?? null,
      ],
    );
  }
}
