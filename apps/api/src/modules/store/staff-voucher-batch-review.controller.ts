import { Body, Controller, Get, Inject, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { PdpClient } from "@yourtal/authz/pdp-client";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import { mapAuthzErrorToHttpException } from "../../shared/authz/authz-error.mapper";
import { Idempotent, NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { PDP_CLIENT } from "../../shared/pdp/pdp-client.module";
import { StaffAction, setStaffAuditContext } from "../staff/staff-action.decorator";
import { VOUCHER_INTERNAL_CLIENT } from "../../shared/voucher-client/voucher-internal-client";
import type { VoucherInternalClient } from "../../shared/voucher-client/voucher-internal-client";
import { ApproveVoucherBatchDto, RejectVoucherBatchDto } from "./dto/staff-voucher-batch-review.schema";
import { LISTING_WRITE_RETENTION_MS } from "./retention";
import { LISTING_REPOSITORY } from "./persistence/listing.repository";
import type { ListingRepository } from "./persistence/listing.repository";
import { VOUCHER_BATCH_REQUEST_REPOSITORY } from "./persistence/voucher-batch-request.repository";
import type { VoucherBatchRequestRepository } from "./persistence/voucher-batch-request.repository";
import { mapStoreErrorToHttpException } from "./to-http-exception";
import {
  approveVoucherBatchRequest,
  listPendingVoucherBatches,
  rejectVoucherBatchRequest,
} from "./use-cases/staff-voucher-batch-review.use-cases";

/**
 * TASKS.md 9.2.c: the staff moderation queue's voucher-batch half. A
 * `moderator` reviews a pending `store.voucher_batch_request` (7.4.c) and
 * either mints it through 4.5's `VoucherInternalClient` (`approveBatch`) or
 * rejects it -- reusing the `voucher_batch` Cerbos kind's own two-person
 * shape, which already refuses a self-approval by role-agnostic condition.
 */
@Controller("api/staff/moderation/voucher-batches")
export class StaffVoucherBatchReviewController {
  constructor(
    private readonly principals: AsyncPrincipalResolver,
    @Inject(VOUCHER_BATCH_REQUEST_REPOSITORY)
    private readonly requests: VoucherBatchRequestRepository,
    @Inject(LISTING_REPOSITORY) private readonly listings: ListingRepository,
    @Inject(VOUCHER_INTERNAL_CLIENT) private readonly vouchers: VoucherInternalClient,
    @Inject(PDP_CLIENT) private readonly pdp: PdpClient,
  ) {}

  @StaffAction("voucher_batch.list")
  @Authorize({ kind: "voucher_batch", action: "view" })
  @NotValueMoving("A read.")
  @Get()
  async list() {
    const result = await listPendingVoucherBatches(this.requests);
    if (result.isErr()) throw mapStoreErrorToHttpException(result.error);
    return { requests: result.value };
  }

  /**
   * Same two-call shape `SettlementDecreaseController.approve` uses:
   * `@Authorize` alone proves this principal is a moderator; the coarse
   * check has no `requestedBy` to compare (a synchronous `attrsFrom` cannot
   * read the request row), so a second, explicit PDP call carries the real
   * attribute once the row is known. The actual self-approval refusal is
   * the repository's own `WHERE requested_by <> $approver` (docs/13c).
   */
  @StaffAction("voucher_batch.approve")
  @Authorize({ kind: "voucher_batch", action: "approve_issuance" })
  @Idempotent({ retentionMs: LISTING_WRITE_RETENTION_MS })
  @Post(":requestId/approve")
  async approve(
    @Param("requestId") requestId: string,
    @Body() body: ApproveVoucherBatchDto,
    @Req() request: FastifyRequest,
  ) {
    const principal = await this.principals.resolve(request);
    const pending = await this.requests.findById(requestId);
    if (pending === null) {
      throw mapStoreErrorToHttpException({ type: "voucher_batch_request_not_found", requestId });
    }

    const authz = await this.pdp.requireAction(
      principal,
      {
        kind: "voucher_batch",
        id: requestId,
        attr: { businessId: pending.merchantId, requestedBy: pending.requestedBy },
      },
      "approve_issuance",
    );
    if (authz.isErr()) throw mapAuthzErrorToHttpException(authz.error);

    const result = await approveVoucherBatchRequest(
      this.requests,
      this.listings,
      this.vouchers,
      requestId,
      principal.id,
    );
    if (result.isErr()) throw mapStoreErrorToHttpException(result.error);
    setStaffAuditContext(request, {
      targetKind: "voucher_batch_request",
      targetId: requestId,
      reason: body.reason,
      detail: { mintedBatchId: result.value.mintedBatchId, quantity: result.value.quantity },
    });
    return result.value;
  }

  @StaffAction("voucher_batch.reject")
  @Authorize({ kind: "voucher_batch", action: "reject_issuance" })
  @Idempotent({ retentionMs: LISTING_WRITE_RETENTION_MS })
  @Post(":requestId/reject")
  async reject(
    @Param("requestId") requestId: string,
    @Body() body: RejectVoucherBatchDto,
    @Req() request: FastifyRequest,
  ) {
    const principal = await this.principals.resolve(request);
    const result = await rejectVoucherBatchRequest(this.requests, requestId, principal.id);
    if (result.isErr()) throw mapStoreErrorToHttpException(result.error);
    setStaffAuditContext(request, {
      targetKind: "voucher_batch_request",
      targetId: requestId,
      reason: body.reason,
    });
    return result.value;
  }
}
