import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { Region } from "@yourtal/contracts/region";
import { staffDisputeQueueSchema, type StaffDisputeQueue } from "@yourtal/contracts/staff/disputes";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { StaffAction, setStaffAuditContext } from "./staff-action.decorator";
import { STAFF_DISPUTE_QUEUE } from "./persistence/staff-dispute-queue";
import type { StaffDisputeQueue as DisputeQueueReader } from "./persistence/staff-dispute-queue";

/**
 * TASKS.md 9.4.d, K13: the captured-voucher dispute queue
 * (`checkout.dispute`, 4.7.c). List-only here -- resolving one is 10.5,
 * which needs Phase 10.
 */
@Controller("api/staff/disputes")
export class StaffDisputesController {
  constructor(@Inject(STAFF_DISPUTE_QUEUE) private readonly disputes: DisputeQueueReader) {}

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
}
