import { BadRequestException } from "@nestjs/common";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Principal } from "@yourtal/authz/principal";
import { lastValueFrom, of, throwError } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import type { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import { StaffAction, setStaffAuditContext } from "./staff-action.decorator";
import { StaffAuditInterceptor } from "./staff-audit.interceptor";
import type { StaffAuditEvent } from "./persistence/staff-audit.repository";

class Routes {
  @StaffAction("kyb.approve")
  approve(): void {}

  plain(): void {}
}

// Only their decorator metadata is read; `this` is never used.
// eslint-disable-next-line @typescript-eslint/unbound-method
const approve = Routes.prototype.approve;
// eslint-disable-next-line @typescript-eslint/unbound-method
const plain = Routes.prototype.plain;

const principal: Principal = {
  id: "staff-1",
  roles: ["user", "ops"],
  attr: { jurisdiction: "AU", businessRoles: {}, isSuspended: false },
};

function setup(recordImpl?: () => Promise<void>) {
  const events: StaffAuditEvent[] = [];
  const record = vi.fn((event: StaffAuditEvent) =>
    (recordImpl ? recordImpl() : Promise.resolve()).then(() => {
      events.push(event);
    }),
  );
  const resolver = {
    resolve: vi.fn(() => Promise.resolve(principal)),
  } as unknown as AsyncPrincipalResolver;
  const interceptor = new StaffAuditInterceptor(new Reflector(), resolver, { record });
  return { interceptor, events, record };
}

function contextFor(handler: () => void, request: object): ExecutionContext {
  return {
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe("StaffAuditInterceptor", () => {
  it("records a succeeded action with the handler's context and staff roles only", async () => {
    const { interceptor, events } = setup();
    const request = { id: "req-1", method: "POST" };
    const next: CallHandler = {
      handle: () => {
        setStaffAuditContext(request as never, {
          targetKind: "business",
          targetId: "biz-1",
          region: "AU",
          reason: "ok",
        });
        return of({ done: true });
      },
    };
    const result = await lastValueFrom(interceptor.intercept(contextFor(approve, request), next));
    expect(result).toEqual({ done: true });
    expect(events).toEqual([
      expect.objectContaining({
        actorUserId: "staff-1",
        actorRoles: ["ops"],
        action: "kyb.approve",
        outcome: "succeeded",
        httpStatus: 201,
        targetKind: "business",
        targetId: "biz-1",
        region: "AU",
        reason: "ok",
        requestId: "req-1",
      }),
    ]);
  });

  it("records a failed action with its status, then rethrows", async () => {
    const { interceptor, events } = setup();
    const next: CallHandler = { handle: () => throwError(() => new BadRequestException("no")) };
    await expect(
      lastValueFrom(interceptor.intercept(contextFor(approve, { method: "POST" }), next)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(events).toEqual([expect.objectContaining({ outcome: "failed", httpStatus: 400 })]);
  });

  it("does not fail a completed action when the audit write fails", async () => {
    const { interceptor } = setup(() => Promise.reject(new Error("db down")));
    const next: CallHandler = { handle: () => of("done") };
    await expect(
      lastValueFrom(interceptor.intercept(contextFor(approve, { method: "POST" }), next)),
    ).resolves.toBe("done");
  });

  it("ignores a route without @StaffAction", async () => {
    const { interceptor, record } = setup();
    const next: CallHandler = { handle: () => of("x") };
    await lastValueFrom(interceptor.intercept(contextFor(plain, {}), next));
    expect(record).not.toHaveBeenCalled();
  });
});
