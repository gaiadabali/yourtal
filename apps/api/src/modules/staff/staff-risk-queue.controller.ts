import {
  BadGatewayException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { ResultAsync } from "neverthrow";
import { createZodDto } from "nestjs-zod";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import type { RiskFlag } from "@yourtal/contracts/ledger-internal/risk";
import { staffRiskResolveRequestSchema, type StaffRiskFlag } from "@yourtal/contracts/staff/risk-queue";
import type { Region } from "@yourtal/contracts/region";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { PrincipalService } from "../../shared/authz/principal.service";
import {
  LEDGER_INTERNAL_CLIENT,
  type LedgerInternalClient,
} from "../../shared/ledger-client/ledger-internal-client";
import { StaffAction, setStaffAuditContext } from "./staff-action.decorator";

class ResolveDto extends createZodDto(staffRiskResolveRequestSchema) {}

function toStaffFlag(flag: RiskFlag): StaffRiskFlag {
  return {
    id: flag.id,
    userId: flag.userId,
    region: flag.region,
    severity: flag.severity,
    reason: flag.reason,
    signals: flag.signals,
    ...(flag.escrowId === undefined ? {} : { escrowId: flag.escrowId }),
    status: flag.status,
    createdAt: flag.createdAt,
  };
}

/**
 * TASKS.md 10.5.a: the real RiskGate's manual-review queue (10.4.b). Every
 * action is `risk_analyst`-only -- same separation of duties
 * user_account.yaml already states for suspend/reinstate (risk_flag.yaml).
 */
@Controller("api/staff/risk")
export class StaffRiskQueueController {
  constructor(
    private readonly principals: PrincipalService,
    @Inject(LEDGER_INTERNAL_CLIENT) private readonly ledger: LedgerInternalClient,
  ) {}

  @StaffAction("risk.view_queue")
  @Authorize({ kind: "risk_flag", action: "view", idFrom: () => "self" })
  @Get("queue")
  async list(
    @Req() request: FastifyRequest,
    @Query("region") region: Region,
  ): Promise<readonly StaffRiskFlag[]> {
    const result = await unwrapLedger(this.ledger.riskQueueList({ region }));
    setStaffAuditContext(request, { targetKind: "risk_queue", targetId: "self", region });
    return result.flags.map(toStaffFlag);
  }

  @StaffAction("risk.release")
  @Authorize({ kind: "risk_flag", action: "release", idFrom: () => "self" })
  @Post("queue/:id/release")
  async release(
    @Param("id") id: string,
    @Body() body: ResolveDto,
    @Req() request: FastifyRequest,
  ): Promise<StaffRiskFlag> {
    const actor = await this.principals.resolve(request);
    const flag = await unwrapLedger(
      this.ledger.riskQueueRelease({
        id,
        resolvedBy: actor.id,
        ...(body.resolutionNote === undefined ? {} : { resolutionNote: body.resolutionNote }),
      }),
    );
    setStaffAuditContext(request, {
      targetKind: "risk_flag",
      targetId: id,
      region: flag.region,
      ...(body.resolutionNote === undefined ? {} : { reason: body.resolutionNote }),
    });
    return toStaffFlag(flag);
  }

  @StaffAction("risk.suspend")
  @Authorize({ kind: "risk_flag", action: "suspend", idFrom: () => "self" })
  @Post("queue/:id/suspend")
  async suspend(
    @Param("id") id: string,
    @Body() body: ResolveDto,
    @Req() request: FastifyRequest,
  ): Promise<StaffRiskFlag> {
    const actor = await this.principals.resolve(request);
    const flag = await unwrapLedger(
      this.ledger.riskQueueSuspend({
        id,
        resolvedBy: actor.id,
        ...(body.resolutionNote === undefined ? {} : { resolutionNote: body.resolutionNote }),
      }),
    );
    setStaffAuditContext(request, {
      targetKind: "risk_flag",
      targetId: id,
      region: flag.region,
      ...(body.resolutionNote === undefined ? {} : { reason: body.resolutionNote }),
    });
    return toStaffFlag(flag);
  }
}

// Same shape staff-users.controller.ts's own unwrapLedger uses: a refusal
// the contract names (idempotency_conflict here means "not pending") is a
// real 409, not a 500.
async function unwrapLedger<T>(result: ResultAsync<T, LedgerError>): Promise<T> {
  const settled = await result;
  if (settled.isErr()) {
    if (settled.error.code === "idempotency_conflict") {
      throw new NotFoundException({ code: settled.error.code, message: settled.error.message });
    }
    throw new BadGatewayException({ code: settled.error.code, message: settled.error.message });
  }
  return settled.value;
}
