import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { charityDecisionRequestSchema, charityStateSchema } from "@yourtal/contracts/charity";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { StaffAction, setStaffAuditContext } from "../staff/staff-action.decorator";
import { CHARITY_DB, CharityRepository } from "./charity.repository";

const hasReason = (request: FastifyRequest) => {
  const reason = (request.body as { reason?: unknown } | undefined)?.reason;
  return { hasReason: typeof reason === "string" && reason.trim().length >= 3 };
};

/**
 * 13.21.a: `/staff/charities`. Ops review every region's applications and
 * approve or reject each with a reason; the decision row and the staff audit
 * event both record it. Staff cross regions by design.
 */
@Controller("api/staff/charities")
export class StaffCharityController {
  constructor(
    @Inject(CHARITY_DB) private readonly charities: CharityRepository,
    private readonly principals: AsyncPrincipalResolver,
  ) {}

  @StaffAction("charity.list")
  @Authorize({ kind: "charity", action: "review", idFrom: () => "registry" })
  @NotValueMoving("A read.")
  @Get()
  async list(@Query("state") stateParam: string | undefined) {
    const state = stateParam === undefined ? null : charityStateSchema.safeParse(stateParam);
    if (state !== null && !state.success) {
      throw new BadRequestException({ code: "invalid_state", message: "unknown state" });
    }
    return { charities: await this.charities.listForStaff(state?.data ?? null) };
  }

  @StaffAction("charity.decide")
  @Authorize({ kind: "charity", action: "decide", attrsFrom: hasReason })
  @NotValueMoving(
    "Only a pending application can be decided: a retry after the first call gets 409, never a second decision.",
  )
  @Post(":charityId/decision")
  async decide(
    @Param("charityId") charityId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    const parsed = charityDecisionRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: "invalid_decision", message: parsed.error.message });
    }
    const staff = await this.principals.resolve(request);
    const decided = await this.charities.decide(
      charityId,
      staff.id,
      parsed.data.decision,
      parsed.data.reason,
    );
    if (decided === null) {
      throw new ConflictException({ code: "already_decided", message: "Not pending." });
    }
    setStaffAuditContext(request, {
      targetKind: "charity",
      targetId: charityId,
      region: decided.region,
      reason: parsed.data.reason,
      detail: { decision: parsed.data.decision },
    });
    return decided;
  }
}
