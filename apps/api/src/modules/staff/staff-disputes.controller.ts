import {
  BadGatewayException,
  Body,
  Controller,
  ConflictException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { createZodDto } from "nestjs-zod";
import type { Region } from "@yourtal/contracts/region";
import {
  disputeResolutionResultSchema,
  resolveDisputeRequestSchema,
  staffDisputeQueueSchema,
  type DisputeResolutionResult,
  type StaffDisputeQueue,
} from "@yourtal/contracts/staff/disputes";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { PrincipalService } from "../../shared/authz/principal.service";
import {
  LEDGER_INTERNAL_CLIENT,
  type LedgerInternalClient,
} from "../../shared/ledger-client/ledger-internal-client";
import { LedgerNotFoundError } from "../../shared/ledger-client/ledger-not-found";
import { Idempotent } from "../../shared/idempotency/idempotent.decorator";
import { StaffAction, setStaffAuditContext } from "./staff-action.decorator";
import { STAFF_DISPUTE_QUEUE } from "./persistence/staff-dispute-queue";
import type { StaffDisputeQueue as DisputeQueueReader } from "./persistence/staff-dispute-queue";
import { STAFF_DISPUTE_RESOLUTION } from "./persistence/staff-dispute-resolution";
import type { StaffDisputeResolution } from "./persistence/staff-dispute-resolution";

class ResolveDisputeDto extends createZodDto(resolveDisputeRequestSchema) {}

// TASKS.md 12.3.d, same 24h window `staff-economy.controller.ts`'s
// `ECONOMY_RETENTION_MS` uses for its own staff proposal/approval routes: a
// staff member retries within a session, never across days, and the
// ledger's own `recoverCapture` idempotency key (captureId) already covers
// a slower retry independently of this table.
const DISPUTE_RESOLVE_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * TASKS.md 9.4.d, K13: the captured-voucher dispute queue
 * (`checkout.dispute`, 4.7.c). `resolve` is 10.5.b: posts the ledger's own
 * recovery line (`recoverCapture`, reversing the S-scaled payable the
 * original capture posted) against the merchant, finance-only
 * (voucher_dispute.yaml).
 */
@Controller("api/staff/disputes")
export class StaffDisputesController {
  constructor(
    @Inject(STAFF_DISPUTE_QUEUE) private readonly disputes: DisputeQueueReader,
    @Inject(STAFF_DISPUTE_RESOLUTION) private readonly resolutions: StaffDisputeResolution,
    private readonly principals: PrincipalService,
    @Inject(LEDGER_INTERNAL_CLIENT) private readonly ledger: LedgerInternalClient,
  ) {}

  @StaffAction("dispute.view_queue")
  @Authorize({ kind: "voucher_dispute", action: "view", idFrom: () => "self" })
  @Get()
  async list(
    @Req() request: FastifyRequest,
    @Query("region") region?: Region,
  ): Promise<StaffDisputeQueue> {
    const rows = await this.disputes.list(region);
    setStaffAuditContext(request, {
      targetKind: "dispute_queue",
      targetId: "self",
      ...(region === undefined ? {} : { region }),
    });
    return staffDisputeQueueSchema.parse(
      rows.map((row) => ({
        voucherId: row.voucherId,
        sagaId: row.sagaId,
        userId: row.userId,
        region: row.region,
        reason: row.reason,
        createdAt: row.createdAt.toISOString(),
      })),
    );
  }

  @StaffAction("dispute.resolve")
  @Idempotent({ retentionMs: DISPUTE_RESOLVE_RETENTION_MS })
  @Authorize({ kind: "voucher_dispute", action: "resolve", idFrom: () => "self" })
  @Post(":voucherId/resolve")
  async resolve(
    @Param("voucherId") voucherId: string,
    @Body() body: ResolveDisputeDto,
    @Req() request: FastifyRequest,
  ): Promise<DisputeResolutionResult> {
    const captureId = await this.resolutions.findCaptureIdForVoucher(voucherId);
    if (captureId === null) {
      throw new NotFoundException({
        code: "capture_not_found",
        message: `voucher ${voucherId} was never captured`,
      });
    }

    let posting;
    try {
      const result = await this.ledger.recoverCapture({ captureId, reason: body.reason });
      if (result.isErr()) {
        throw new BadGatewayException({ code: result.error.code, message: result.error.message });
      }
      posting = result.value;
    } catch (cause) {
      if (cause instanceof LedgerNotFoundError) {
        throw new NotFoundException({
          code: "capture_not_found",
          message: `no capture ${captureId} on the ledger`,
        });
      }
      throw cause;
    }

    const actor = await this.principals.resolve(request);
    try {
      await this.resolutions.record({
        voucherId,
        captureId,
        recoveryPostingId: posting.id,
        resolvedBy: actor.id,
        resolutionNote: body.reason,
      });
    } catch (cause) {
      // The ledger's own idempotency key (captureId) already makes a
      // retried recoverCapture a no-op (posting.id comes back the same) --
      // this table's PRIMARY KEY on voucher_id is refused only by a second
      // resolve of the SAME dispute, which is a 409, not a lost recovery.
      throw new ConflictException({
        code: "already_resolved",
        message: `voucher ${voucherId} was already resolved: ${String(cause)}`,
      });
    }

    setStaffAuditContext(request, {
      targetKind: "dispute",
      targetId: voucherId,
      reason: body.reason,
      detail: { captureId, recoveryPostingId: posting.id, amountMinor: posting.amountMinor },
    });

    return disputeResolutionResultSchema.parse({
      voucherId,
      recoveryPostingId: posting.id,
      amountMinor: posting.amountMinor,
      currency: posting.currency,
    });
  }
}
