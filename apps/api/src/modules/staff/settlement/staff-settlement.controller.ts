import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { PdpClient } from "@yourtal/authz/pdp-client";
import type { Region } from "@yourtal/contracts/region";
import type { SettlementQueue } from "@yourtal/contracts/staff/settlement";
import type { EconomyProposal } from "@yourtal/contracts/staff/economy";
import { LEDGER_INTERNAL_CLIENT } from "../../../shared/ledger-client/ledger-internal-client";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import { LedgerNotFoundError } from "../../../shared/ledger-client/ledger-not-found";
import { Authorize } from "../../../shared/authz/authorize.decorator";
import { AsyncPrincipalResolver } from "../../../shared/authz/async-principal-resolver";
import { mapAuthzErrorToHttpException } from "../../../shared/authz/authz-error.mapper";
import { PDP_CLIENT } from "../../../shared/pdp/pdp-client.module";
import { Idempotent, NotValueMoving } from "../../../shared/idempotency/idempotent.decorator";
import { StaffAction, setStaffAuditContext } from "../staff-action.decorator";
import {
  ECONOMY_PROPOSAL_REPOSITORY,
  toEconomyProposal,
} from "../economy/persistence/economy-proposal.repository";
import type {
  EconomyProposalRepository,
  EconomyProposalRow,
} from "../economy/persistence/economy-proposal.repository";
import {
  DecideSettlementProposalDto,
  ProposePayoutDto,
  ResolveStatementDisputeDto,
} from "./dto/settlement.dto";
import { mapSettlementErrorToHttpException } from "./to-http-exception";

const SETTLEMENT_RETENTION_MS = 24 * 60 * 60 * 1000;

function parseRegion(raw: string): Region {
  if (raw !== "AU" && raw !== "ID") {
    throw new BadRequestException({ code: "unknown_region", message: `unknown region ${raw}` });
  }
  return raw;
}

/**
 * TASKS.md 10.6.a: the staff console's settlement screens -- weekly
 * statements (10.1.b's own queue, `ledger.statementQueue`), resolving a
 * statement's own dispute (raised by the business through 10.6.b), and
 * payout approval. Every route sits under `api/staff/settlement`, alongside
 * `api/staff/economy` (9.5) -- staff routes are never tenant-scoped.
 *
 * Payout approval follows 9.5's own two-step shape exactly (see
 * `staff-economy.controller.ts`'s own header): `@Authorize` proves the
 * caller may act on `ledger_adjustment` AT ALL, and `approvePayout`
 * additionally makes a second, explicit `pdp.requireAction` call once the
 * proposal's real `proposedBy` is known from a DB read -- the only way
 * `nobody-approves-their-own-adjustment` can ever see the real attribute,
 * since `attrsFrom` runs before any repository call. "Propose" here is
 * bookkeeping only (no ledger call, like 9.5.c's marketing funding): there
 * is no `ledger-internal` propose-payout operation, only `approvePayout`
 * itself, which the second approver's route calls.
 */
@Controller("api/staff/settlement")
export class StaffSettlementController {
  constructor(
    private readonly principals: AsyncPrincipalResolver,
    @Inject(PDP_CLIENT) private readonly pdp: PdpClient,
    @Inject(LEDGER_INTERNAL_CLIENT) private readonly ledger: LedgerInternalClient,
    @Inject(ECONOMY_PROPOSAL_REPOSITORY) private readonly proposals: EconomyProposalRepository,
  ) {}

  // -- the queue: every open or disputed statement in a region -----------

  @Authorize({ kind: "billing", action: "view_statement_queue", attrsFrom: () => ({ businessId: "staff" }) })
  @StaffAction("settlement.view_queue")
  @NotValueMoving("A read.")
  @Get(":region/queue")
  async queue(@Param("region") regionParam: string): Promise<SettlementQueue> {
    const region = parseRegion(regionParam);
    const result = await this.ledger.statementQueue(region);
    if (result.isErr()) throw mapSettlementErrorToHttpException(result.error);
    return { region, statements: [...result.value] };
  }

  // -- resolving a statement's own dispute (10.6.b raised it) -------------

  @Authorize({ kind: "billing", action: "resolve_dispute", attrsFrom: () => ({ businessId: "staff" }) })
  @StaffAction("settlement.resolve_dispute")
  @Idempotent({ retentionMs: SETTLEMENT_RETENTION_MS })
  @Post("statements/:id/resolve-dispute")
  async resolveDispute(
    @Param("id") id: string,
    @Body() body: ResolveStatementDisputeDto,
    @Req() request: FastifyRequest,
  ) {
    try {
      const result = await this.ledger.resolveStatementDispute({
        statementId: id,
        note: body.note,
      });
      if (result.isErr()) throw mapSettlementErrorToHttpException(result.error);
      setStaffAuditContext(request, {
        targetKind: "statement",
        targetId: id,
        region: result.value.region,
      });
      return result.value;
    } catch (cause) {
      if (cause instanceof LedgerNotFoundError) {
        throw new NotFoundException({ code: "statement_not_found", message: `no statement ${id}` });
      }
      throw cause;
    }
  }

  // -- payout approval, two-person -----------------------------------------

  @Authorize({
    kind: "ledger_adjustment",
    action: "view",
    idFrom: () => "payout",
    attrsFrom: () => ({ createdBy: "n/a" }),
  })
  @StaffAction("settlement.view_payout_proposals")
  @NotValueMoving("A read.")
  @Get(":region/payout-proposals")
  async payoutProposals(@Param("region") regionParam: string): Promise<readonly EconomyProposal[]> {
    const region = parseRegion(regionParam);
    const rows = await this.proposals.listAll(region, "approve_payout");
    return rows.map(toEconomyProposal);
  }

  @Authorize({
    kind: "ledger_adjustment",
    action: "propose_payout",
    idFrom: () => "new",
    // Schema enforcement is `reject` (infra/cerbos/config.yaml): `createdBy`
    // is a REQUIRED field on this resource kind, so even this coarse,
    // request-only check must supply one -- a placeholder here, since the
    // real value needs a DB read the approve route does explicitly below.
    attrsFrom: () => ({ createdBy: "n/a" }),
  })
  @StaffAction("settlement.propose_payout")
  @Idempotent({ retentionMs: SETTLEMENT_RETENTION_MS })
  @Post(":region/statements/:id/payout-proposals")
  async proposePayout(
    @Param("region") regionParam: string,
    @Param("id") id: string,
    @Body() body: ProposePayoutDto,
    @Req() request: FastifyRequest,
  ): Promise<EconomyProposal> {
    const region = parseRegion(regionParam);
    const principal = await this.principals.resolve(request);

    const row = await this.proposals.create({
      kind: "approve_payout",
      region,
      summary: `Payout for statement ${id}`,
      payload: { statementId: id },
      proposedBy: principal.id,
      ...(body.reason === undefined ? {} : { reason: body.reason }),
    });
    setStaffAuditContext(request, {
      targetKind: "statement",
      targetId: id,
      region,
      ...(body.reason === undefined ? {} : { reason: body.reason }),
    });
    return toEconomyProposal(row);
  }

  @Authorize({
    kind: "ledger_adjustment",
    action: "approve_payout",
    attrsFrom: () => ({ createdBy: "n/a" }),
  })
  @StaffAction("settlement.approve_payout")
  @Idempotent({ retentionMs: SETTLEMENT_RETENTION_MS })
  @Post(":region/payout-proposals/:proposalId/approve")
  async approvePayout(
    @Param("region") regionParam: string,
    @Param("proposalId") proposalId: string,
    @Body() body: DecideSettlementProposalDto,
    @Req() request: FastifyRequest,
  ): Promise<EconomyProposal> {
    const region = parseRegion(regionParam);
    const principal = await this.principals.resolve(request);
    const row = await this.requireProposal(proposalId, region);

    // Real two-person check: `attrsFrom` cannot see `row.proposedBy` (a DB
    // read), so the coarse `@Authorize` above only proved "this principal is
    // finance at all". This is what actually refuses a self-approval.
    const authz = await this.pdp.requireAction(
      principal,
      { kind: "ledger_adjustment", id: proposalId, attr: { createdBy: row.proposedBy } },
      "approve_payout",
    );
    if (authz.isErr()) throw mapAuthzErrorToHttpException(authz.error);

    const payload = row.payload as { statementId?: string };
    if (typeof payload.statementId !== "string") {
      throw new BadRequestException({ code: "invalid_proposal", message: "no statement id" });
    }

    try {
      const approveResult = await this.ledger.approvePayout({
        statementId: payload.statementId,
        approvedBy: principal.id,
      });
      if (approveResult.isErr()) throw mapSettlementErrorToHttpException(approveResult.error);

      const decided = await this.proposals.approve(
        row.id,
        principal.id,
        approveResult.value,
        body.note,
      );
      setStaffAuditContext(request, {
        targetKind: "statement",
        targetId: payload.statementId,
        region,
      });
      return toEconomyProposal(decided);
    } catch (cause) {
      if (cause instanceof LedgerNotFoundError) {
        throw new NotFoundException({
          code: "statement_not_found",
          message: `no statement ${payload.statementId}`,
        });
      }
      throw cause;
    }
  }

  private async requireProposal(id: string, region: Region): Promise<EconomyProposalRow> {
    const row = await this.proposals.findById(id);
    if (row === null || row.region !== region || row.kind !== "approve_payout") {
      throw new NotFoundException({
        code: "proposal_not_found",
        message: `no payout proposal ${id}`,
      });
    }
    if (row.status !== "pending") {
      throw new BadRequestException({
        code: "already_decided",
        message: `proposal ${id} is already ${row.status}`,
      });
    }
    return row;
  }
}
