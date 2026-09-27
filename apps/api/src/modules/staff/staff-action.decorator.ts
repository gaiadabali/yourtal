import { SetMetadata } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

export const STAFF_ACTION_METADATA = "yourtal:staff-action";
export const STAFF_UNAUDITED_METADATA = "yourtal:staff-unaudited";

/**
 * Names a staff console route's action for the audit trail (TASKS.md 9.1.a),
 * as a dotted verb such as `kyb.approve`. `StaffAuditInterceptor` writes one
 * `staff.audit_event` row per call, whether it succeeds or fails.
 * `staff-routes-audited.test.ts` fails the build for a staff route with
 * neither this nor `@StaffUnaudited`.
 */
export const StaffAction = (action: string): MethodDecorator =>
  SetMetadata(STAFF_ACTION_METADATA, action);

/** For the rare route that changes and reveals nothing about anyone else, like `GET /api/staff/me`. */
export const StaffUnaudited = (reason: string): MethodDecorator =>
  SetMetadata(STAFF_UNAUDITED_METADATA, reason);

/** What a handler knows that the route alone does not: whom it acted on, where, and why. */
export interface StaffAuditContext {
  readonly targetKind?: string;
  readonly targetId?: string;
  readonly region?: "AU" | "ID";
  readonly reason?: string;
  readonly detail?: Record<string, unknown>;
}

const contexts = new WeakMap<FastifyRequest, StaffAuditContext>();

/** Called by a handler before it returns or throws; merged into its audit row. */
export function setStaffAuditContext(request: FastifyRequest, context: StaffAuditContext): void {
  contexts.set(request, { ...contexts.get(request), ...context });
}

export function staffAuditContextOf(request: FastifyRequest): StaffAuditContext {
  return contexts.get(request) ?? {};
}
