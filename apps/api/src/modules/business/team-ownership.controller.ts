import { Body, Controller, HttpCode, Inject, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { TransferOwnershipDto } from "./dto/transfer-ownership.schema";
import { BUSINESS_ACCOUNT_REPOSITORY } from "./persistence/business-account.repository";
import type { BusinessAccountRepository } from "./persistence/business-account.repository";
import {
  TRANSFER_OWNERSHIP_UNIT_OF_WORK,
  type TransferOwnershipUnitOfWork,
} from "./persistence/transfer-ownership.unit-of-work";
import { mapBusinessErrorToHttpException } from "./to-http-exception";
import { transferOwnership } from "./use-cases/transfer-ownership.use-case";

/**
 * docs/17 section 2.1: ownership moves only through this door, never
 * `change_role` (`team.yaml`'s `ownership-moves-only-by-transfer` DENY).
 * `team.yaml`'s own `ownership-transfer-needs-fresh-reauth` rule refuses
 * this action outright until step-up re-authentication exists
 * (`P.attr.reauthenticatedAt` is documented as unpopulated pending
 * YT-0540/0541's follow-on work) — this endpoint is real and PDP-gated
 * today, and starts working the moment that attribute is populated.
 */
@Controller("api/:tenantId/business/team")
export class TeamOwnershipController {
  constructor(
    private readonly principals: AsyncPrincipalResolver,
    @Inject(BUSINESS_ACCOUNT_REPOSITORY) private readonly businesses: BusinessAccountRepository,
    @Inject(TRANSFER_OWNERSHIP_UNIT_OF_WORK)
    private readonly unitOfWork: TransferOwnershipUnitOfWork,
  ) {}

  @NotValueMoving(
    "Ownership ends at a named person either way; a retry after a timeout finds the " +
      "transfer already done and reports the same end state, not a second demotion.",
  )
  @Authorize({ kind: "team", action: "transfer_ownership" })
  @HttpCode(200)
  @Post("transfer-ownership")
  async transfer(
    @Param("tenantId") tenantId: string,
    @Body() body: TransferOwnershipDto,
    @Req() request: FastifyRequest,
  ) {
    const principal = await this.principals.resolve(request);
    const result = await transferOwnership(this.businesses, this.unitOfWork, {
      businessId: tenantId,
      currentOwnerUserId: principal.id,
      newOwnerUserId: body.newOwnerUserId,
    });
    if (result.isErr()) {
      throw mapBusinessErrorToHttpException(result.error);
    }
    return result.value;
  }
}
