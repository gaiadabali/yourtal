import { HttpException, Inject, Injectable, Logger } from "@nestjs/common";
import type { CallHandler, ExecutionContext, NestInterceptor } from "@nestjs/common";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { from, lastValueFrom, type Observable } from "rxjs";
import { isInternalRole } from "@yourtal/authz/roles";
import { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import { STAFF_ACTION_METADATA, staffAuditContextOf } from "./staff-action.decorator";
import { STAFF_AUDIT_REPOSITORY } from "./persistence/staff-audit.repository";
import type { StaffAuditRepository } from "./persistence/staff-audit.repository";

const logger = new Logger("StaffAudit");

/**
 * Writes one `staff.audit_event` row for every call to a route carrying
 * `@StaffAction` (TASKS.md 9.1.a), after the handler settles. Runs after
 * `PdpGuard`, so a refused caller never reaches it: only actions that were
 * allowed to run are recorded, with how they ended.
 */
@Injectable()
export class StaffAuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly principals: AsyncPrincipalResolver,
    @Inject(STAFF_AUDIT_REPOSITORY) private readonly audit: StaffAuditRepository,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const action = this.reflector.get<string | undefined>(
      STAFF_ACTION_METADATA,
      context.getHandler(),
    );
    if (action === undefined) {
      return next.handle();
    }
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    // Nest sets the reply status only after interceptors, so read what it will set.
    const successStatus =
      this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler()) ??
      (request.method === "POST" ? 201 : 200);
    return from(this.run(request, action, successStatus, next));
  }

  private async run(
    request: FastifyRequest,
    action: string,
    successStatus: number,
    next: CallHandler,
  ): Promise<unknown> {
    try {
      const result = await lastValueFrom(next.handle(), { defaultValue: undefined });
      await this.write(request, action, "succeeded", successStatus);
      return result;
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 500;
      await this.write(request, action, "failed", status);
      throw error;
    }
  }

  private async write(
    request: FastifyRequest,
    action: string,
    outcome: "succeeded" | "failed",
    httpStatus: number,
  ): Promise<void> {
    try {
      const principal = await this.principals.resolve(request);
      const extra = staffAuditContextOf(request);
      await this.audit.record({
        actorUserId: principal.id,
        actorRoles: principal.roles.filter(isInternalRole),
        action,
        outcome,
        httpStatus,
        targetKind: extra.targetKind,
        targetId: extra.targetId,
        region: extra.region,
        reason: extra.reason,
        detail: extra.detail,
        requestId: request.id,
      });
    } catch (error) {
      // The action has already happened; failing the response now would
      // invite a retry of something done. Loud instead, so it is chased.
      logger.error(
        `audit write failed for ${action}`,
        error instanceof Error ? error.stack : error,
      );
    }
  }
}
