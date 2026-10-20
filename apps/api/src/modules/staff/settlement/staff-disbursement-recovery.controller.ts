import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { PdpClient } from "@yourtal/authz/pdp-client";
import type { Region } from "@yourtal/contracts/region";
import type { EconomyProposal } from "@yourtal/contracts/staff/economy";
import type { CheckDisbursementResult } from "@yourtal/contracts/staff/settlement";
import { Authorize } from "../../../shared/authz/authorize.decorator";
import { AsyncPrincipalResolver } from "../../../shared/authz/async-principal-resolver";
import { mapAuthzErrorToHttpException } from "../../../shared/authz/authz-error.mapper";
import { PDP_CLIENT } from "../../../shared/pdp/pdp-client.module";
import { Idempotent, NotValueMoving } from "../../../shared/idempotency/idempotent.decorator";
import { DISBURSEMENTS } from "../../payouts/disbursement.repository";
import type { DisbursementRepository } from "../../payouts/disbursement.repository";
import {
  ECONOMY_PROPOSAL_REPOSITORY,
  toEconomyProposal,
} from "../economy/persistence/economy-proposal.repository";
import type { EconomyProposalRepository } from "../economy/persistence/economy-proposal.repository";
import { StaffAction, setStaffAuditContext } from "../staff-action.decorator";
import { DecideSettlementProposalDto } from "./dto/settlement.dto";
import { ProposeDisbursementRetryDto } from "./dto/recovery.dto";
import { DisbursementRecoveryService } from "./disbursement-recovery.service";
import { toStaffDisbursement } from "./to-staff-disbursement";

const RETENTION_MS = 24 * 60 * 60 * 1000;

function parseRegion(raw: string): Region {
  if (raw !== "AU" && raw !== "ID") {
    throw new BadRequestException({ code: "unknown_region", message: `unknown region ${raw}` });
  }
  return raw;
}

/**
 * 5.2.c: staff actions on a payout the job will not move by itself. "Check
 * again" reads the processor and records what it shows (single-person: it moves
 * no money, and a transfer it finds is paid out under the statement's own
 * two-person approval). A retry is two-person and a new payout attempt, never a
 * second transfer; see `DisbursementRecoveryService`. Authorization follows
 * `StaffEconomyController`: `@Authorize` proves finance at all, and approval asks
 * the PDP again with the proposal's real proposer.
 */
@Controller("api/staff/settlement")
export class StaffDisbursementRecoveryController {
  constructor(
    private readonly principals: AsyncPrincipalResolver,
    @Inject(PDP_CLIENT) private readonly pdp: PdpClient,
    private readonly recovery: DisbursementRecoveryService,
    @Inject(DISBURSEMENTS) private readonly disbursements: DisbursementRepository,
    @Inject(ECONOMY_PROPOSAL_REPOSITORY) private readonly proposals: EconomyProposalRepository,
  ) {}

  @Authorize({
    kind: "ledger_adjustment",
    action: "check_payout",
    idFrom: () => "payout",
    attrsFrom: () => ({ createdBy: "n/a" }),
  })
  @StaffAction("settlement.check_payout")
  @NotValueMoving(
    "Reads the processor and records what it shows; it sends no money, and a repeat finds the row already settled.",
  )
  @Post(":region/disbursements/:id/check")
  async check(
    @Param("region") regionParam: string,
    @Param("id") id: string,
    @Req() request: FastifyRequest,
  ): Promise<CheckDisbursementResult> {
    const region = parseRegion(regionParam);
    setStaffAuditContext(request, { targetKind: "disbursement", targetId: id, region });
    const outcome = await this.recovery.check(region, id);
    const row = await this.disbursements.findOne(id);
    if (row === null) throw new NotFoundException({ code: "disbursement_not_found", message: id });
    setStaffAuditContext(request, { detail: { outcome } });
    const pending = await this.proposals.listPending(region, "retry_disbursement");
    const retry = pending.find((proposal) => proposal.payload["disbursementId"] === id);
    return {
      outcome,
      disbursement: toStaffDisbursement(row, retry === undefined ? null : toEconomyProposal(retry)),
    };
  }

  @Authorize({
    kind: "ledger_adjustment",
    action: "propose_payout_retry",
    idFrom: () => "new",
    attrsFrom: () => ({ createdBy: "n/a" }),
  })
  @StaffAction("settlement.propose_payout_retry")
  @Idempotent({ retentionMs: RETENTION_MS })
  @Post(":region/disbursements/:id/retry-proposals")
  async propose(
    @Param("region") regionParam: string,
    @Param("id") id: string,
    @Body() body: ProposeDisbursementRetryDto,
    @Req() request: FastifyRequest,
  ): Promise<EconomyProposal> {
    const region = parseRegion(regionParam);
    const principal = await this.principals.resolve(request);
    setStaffAuditContext(request, {
      targetKind: "disbursement",
      targetId: id,
      region,
      reason: body.reason,
    });
    return toEconomyProposal(
      await this.recovery.proposeRetry(region, id, principal.id, body.reason),
    );
  }

  @Authorize({
    kind: "ledger_adjustment",
    action: "approve_payout_retry",
    attrsFrom: () => ({ createdBy: "n/a" }),
  })
  @StaffAction("settlement.approve_payout_retry")
  @Idempotent({ retentionMs: RETENTION_MS })
  @Post(":region/retry-proposals/:proposalId/approve")
  async approve(
    @Param("region") regionParam: string,
    @Param("proposalId") proposalId: string,
    @Body() body: DecideSettlementProposalDto,
    @Req() request: FastifyRequest,
  ): Promise<EconomyProposal> {
    const region = parseRegion(regionParam);
    const principal = await this.principals.resolve(request);
    const row = await this.recovery.requirePending(region, proposalId);
    const authz = await this.pdp.requireAction(
      principal,
      { kind: "ledger_adjustment", id: proposalId, attr: { createdBy: row.proposedBy } },
      "approve_payout_retry",
    );
    if (authz.isErr()) throw mapAuthzErrorToHttpException(authz.error);
    setStaffAuditContext(request, {
      targetKind: "disbursement",
      targetId: String(row.payload["disbursementId"]),
      region,
      detail: { proposalId },
    });
    return toEconomyProposal(
      await this.recovery.approveRetry(region, row, principal.id, body.note),
    );
  }

  /** Declining or withdrawing moves no money, so any finance staff member may, the proposer included. */
  @Authorize({
    kind: "ledger_adjustment",
    action: "propose_payout_retry",
    attrsFrom: () => ({ createdBy: "n/a" }),
  })
  @StaffAction("settlement.reject_payout_retry")
  @Idempotent({ retentionMs: RETENTION_MS })
  @Post(":region/retry-proposals/:proposalId/reject")
  async reject(
    @Param("region") regionParam: string,
    @Param("proposalId") proposalId: string,
    @Body() body: DecideSettlementProposalDto,
    @Req() request: FastifyRequest,
  ): Promise<EconomyProposal> {
    const region = parseRegion(regionParam);
    const principal = await this.principals.resolve(request);
    const row = await this.recovery.requirePending(region, proposalId);
    setStaffAuditContext(request, {
      targetKind: "disbursement",
      targetId: String(row.payload["disbursementId"]),
      region,
      detail: { proposalId },
    });
    return toEconomyProposal(await this.recovery.reject(region, row, principal.id, body.note));
  }
}
