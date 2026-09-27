import { Controller, Get, Inject, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { isInternalRole } from "@yourtal/authz/roles";
import type { StaffSession } from "@yourtal/contracts/staff/session";
import { staffSessionSchema } from "@yourtal/contracts/staff/session";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import { StaffUnaudited } from "./staff-action.decorator";
import { STAFF_DIRECTORY } from "./persistence/staff-directory";
import type { StaffDirectory } from "./persistence/staff-directory";

/** TASKS.md 9.1: the staff console's own entry point. Its web shell calls this first. */
@Controller("api/staff")
export class StaffConsoleController {
  constructor(
    private readonly principals: AsyncPrincipalResolver,
    @Inject(STAFF_DIRECTORY) private readonly directory: StaffDirectory,
  ) {}

  @StaffUnaudited("reads only the caller's own roles")
  @Authorize({ kind: "staff_console", action: "view", idFrom: () => "self" })
  @Get("me")
  async me(@Req() request: FastifyRequest): Promise<StaffSession> {
    const principal = await this.principals.resolve(request);
    return staffSessionSchema.parse({
      userId: principal.id,
      email: await this.directory.emailOf(principal.id),
      roles: principal.roles.filter(isInternalRole),
      region: principal.attr.jurisdiction,
    });
  }
}
