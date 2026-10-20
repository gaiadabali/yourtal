import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { PdpClient } from "@yourtal/authz/pdp-client";
import type { Region } from "@yourtal/contracts/region";
import type { EconomyProposal } from "@yourtal/contracts/staff/economy";
import type { ParkedPurchases } from "@yourtal/contracts/staff/parked-purchases";
import { Authorize } from "../../../shared/authz/authorize.decorator";
import { AsyncPrincipalResolver } from "../../../shared/authz/async-principal-resolver";
import { mapAuthzErrorToHttpException } from "../../../shared/authz/authz-error.mapper";
import { PDP_CLIENT } from "../../../shared/pdp/pdp-client.module";
import { Idempotent, NotValueMoving } from "../../../shared/idempotency/idempotent.decorator";
import { StaffAction, setStaffAuditContext } from "../staff-action.decorator";
import { DecideProposalDto } from "./dto/economy.dto";
import { ProposeRefundDto } from "./dto/parked-purchases.dto";
import { ParkedPurchasesService } from "./parked-purchases.service";
import { toEconomyProposal } from "./persistence/economy-proposal.repository";

const RETENTION_MS = 24 * 60 * 60 * 1000;

function parseRegion(raw: string): Region {
  if (raw !== "AU" && raw !== "ID") {
    throw new BadRequestException({ code: "unknown_region", message: `unknown region ${raw}` });
  }
  return raw;
}

/**
 * 5.1.g (F123): the finance queue of card purchases YourTal could not turn
 * into points, and their two-person refund. Same two-step authorization as
 * `StaffEconomyController`: `@Authorize` proves finance at all, and approval
 * asks the PDP again with the proposal's real proposer, the only way
 * `nobody-approves-their-own-adjustment` can see it.
 */
@Controller("api/staff/economy")
export class StaffParkedPurchasesController {
  constructor(
    private readonly principals: AsyncPrincipalResolver,
    @Inject(PDP_CLIENT) private readonly pdp: PdpClient,
    private readonly parked: ParkedPurchasesService,
  ) {}

  @Authorize({
    kind: "ledger_adjustment",
    action: "view",
    idFrom: () => "parked-purchases",
    attrsFrom: () => ({ createdBy: "n/a" }),
  })
  @StaffAction("economy.view_parked_purchases")
  @NotValueMoving("A read.")
  @Get(":region/parked-purchases")
  list(@Param("region") regionParam: string): Promise<ParkedPurchases> {
    return this.parked.list(parseRegion(regionParam));
  }

  @Authorize({
    kind: "ledger_adjustment",
    action: "propose_refund",
    idFrom: () => "new",
    attrsFrom: () => ({ createdBy: "n/a" }),
  })
  @StaffAction("economy.propose_refund")
  @Idempotent({ retentionMs: RETENTION_MS })
  @Post(":region/parked-purchases/:purchaseId/refund-proposals")
  async propose(
    @Param("region") regionParam: string,
    @Param("purchaseId") purchaseId: string,
    @Body() body: ProposeRefundDto,
    @Req() request: FastifyRequest,
  ): Promise<EconomyProposal> {
    const region = parseRegion(regionParam);
    const principal = await this.principals.resolve(request);
    setStaffAuditContext(request, {
      targetKind: "card_purchase",
      targetId: purchaseId,
      region,
      reason: body.reason,
    });
    const row = await this.parked.propose(region, purchaseId, principal.id, body.reason);
    return toEconomyProposal(row);
  }

  @Authorize({
    kind: "ledger_adjustment",
    action: "approve_refund",
    attrsFrom: () => ({ createdBy: "n/a" }),
  })
  @StaffAction("economy.approve_refund")
  @Idempotent({ retentionMs: RETENTION_MS })
  @Post(":region/refund-proposals/:id/approve")
  async approve(
    @Param("region") regionParam: string,
    @Param("id") id: string,
    @Body() body: DecideProposalDto,
    @Req() request: FastifyRequest,
  ): Promise<EconomyProposal> {
    const region = parseRegion(regionParam);
    const principal = await this.principals.resolve(request);
    const row = await this.parked.requirePending(region, id);
    const authz = await this.pdp.requireAction(
      principal,
      { kind: "ledger_adjustment", id, attr: { createdBy: row.proposedBy } },
      "approve_refund",
    );
    if (authz.isErr()) throw mapAuthzErrorToHttpException(authz.error);
    const purchaseId = (row.payload as { purchaseId?: string }).purchaseId ?? "";
    setStaffAuditContext(request, {
      targetKind: "card_purchase",
      targetId: purchaseId,
      region,
      detail: { proposalId: id },
    });
    return toEconomyProposal(await this.parked.approve(region, row, principal.id, body.note));
  }

  /** Declining or withdrawing moves no money, so any finance staff member may, the proposer included. */
  @Authorize({
    kind: "ledger_adjustment",
    action: "propose_refund",
    attrsFrom: () => ({ createdBy: "n/a" }),
  })
  @StaffAction("economy.reject_refund")
  @Idempotent({ retentionMs: RETENTION_MS })
  @Post(":region/refund-proposals/:id/reject")
  async reject(
    @Param("region") regionParam: string,
    @Param("id") id: string,
    @Body() body: DecideProposalDto,
    @Req() request: FastifyRequest,
  ): Promise<EconomyProposal> {
    const region = parseRegion(regionParam);
    const principal = await this.principals.resolve(request);
    const row = await this.parked.requirePending(region, id);
    setStaffAuditContext(request, {
      targetKind: "card_purchase",
      targetId: (row.payload as { purchaseId?: string }).purchaseId ?? "",
      region,
      detail: { proposalId: id },
    });
    return toEconomyProposal(await this.parked.reject(region, row, principal.id, body.note));
  }
}
