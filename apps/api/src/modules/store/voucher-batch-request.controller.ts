import { Body, Controller, Get, Inject, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { Idempotent, NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { PrincipalService } from "../../shared/authz/principal.service";
import type { PrincipalResolver } from "../../shared/authz/principal-resolver";
import { CreateVoucherBatchRequestDto } from "./dto/create-voucher-batch-request.schema";
import { LISTING_WRITE_RETENTION_MS } from "./retention";
import { mapStoreErrorToHttpException } from "./to-http-exception";
import { VOUCHER_BATCH_REQUEST_REPOSITORY } from "./persistence/voucher-batch-request.repository";
import type { VoucherBatchRequestRepository } from "./persistence/voucher-batch-request.repository";
import { createVoucherBatchRequest } from "./use-cases/create-voucher-batch-request.use-case";
import { getVoucherBatchRequest } from "./use-cases/get-voucher-batch-request.use-case";
import { listVoucherBatchRequests } from "./use-cases/list-voucher-batch-requests.use-case";

/**
 * 7.4.c: a merchant asking for more stock. Reuses the `voucher_batch`
 * resource kind (`policies/resource_policies/voucher_batch.yaml`), already
 * built for this exact two-person shape (`request_issuance` /
 * `approve_issuance`, nobody approves their own).
 *
 * There is no approve route here on purpose -- 9.2.c (staff console, not
 * built) owns turning an approved request into a real mint through 4.5's
 * `voucher-internal` client. This controller only ever writes `state =
 * 'pending'` rows.
 */
@Controller("api/:tenantId/store/voucher-batch-requests")
export class VoucherBatchRequestController {
  constructor(
    @Inject(PrincipalService) private readonly principals: PrincipalResolver,
    @Inject(VOUCHER_BATCH_REQUEST_REPOSITORY)
    private readonly requests: VoucherBatchRequestRepository,
  ) {}

  @Authorize({ kind: "voucher_batch", action: "request_issuance" })
  @Idempotent({ retentionMs: LISTING_WRITE_RETENTION_MS })
  @Post()
  async create(
    @Param("tenantId") tenantId: string,
    @Body() body: CreateVoucherBatchRequestDto,
    @Req() request: FastifyRequest,
  ) {
    const principal = await this.principals.resolve(request);
    const result = await createVoucherBatchRequest(this.requests, tenantId, {
      listingId: body.listingId,
      quantity: body.quantity,
      reason: body.reason,
      requestedBy: principal.id,
    });
    if (result.isErr()) throw mapStoreErrorToHttpException(result.error);
    return result.value;
  }

  @Authorize({ kind: "voucher_batch", action: "view" })
  @NotValueMoving("A read.")
  @Get()
  async list(@Param("tenantId") tenantId: string) {
    const result = await listVoucherBatchRequests(this.requests, tenantId);
    if (result.isErr()) throw mapStoreErrorToHttpException(result.error);
    return { requests: result.value };
  }

  @Authorize({ kind: "voucher_batch", action: "view" })
  @NotValueMoving("A read.")
  @Get(":requestId")
  async get(@Param("tenantId") tenantId: string, @Param("requestId") requestId: string) {
    const result = await getVoucherBatchRequest(this.requests, tenantId, requestId);
    if (result.isErr()) throw mapStoreErrorToHttpException(result.error);
    return result.value;
  }
}
