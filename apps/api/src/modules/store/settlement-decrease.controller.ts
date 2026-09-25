import { Body, Controller, Inject, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { PdpClient } from "@yourtal/authz/pdp-client";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { mapAuthzErrorToHttpException } from "../../shared/authz/authz-error.mapper";
import { Idempotent } from "../../shared/idempotency/idempotent.decorator";
import { PrincipalService } from "../../shared/authz/principal.service";
import type { PrincipalResolver } from "../../shared/authz/principal-resolver";
import { PDP_CLIENT } from "../../shared/pdp/pdp-client.module";
import { ProposeSettlementDecreaseDto } from "./dto/propose-settlement-decrease.schema";
import { LISTING_REPOSITORY } from "./persistence/listing.repository";
import type { ListingRepository } from "./persistence/listing.repository";
import { SETTLEMENT_DECREASE_REQUEST_REPOSITORY } from "./persistence/settlement-decrease-request.repository";
import type { SettlementDecreaseRequestRepository } from "./persistence/settlement-decrease-request.repository";
import { LISTING_WRITE_RETENTION_MS } from "./retention";
import { mapStoreErrorToHttpException } from "./to-http-exception";
import { approveSettlementDecrease } from "./use-cases/approve-settlement-decrease.use-case";
import { proposeSettlementDecrease } from "./use-cases/propose-settlement-decrease.use-case";

/**
 * The two-person-approval workflow for a material settlement-value decrease
 * (YT-0575), split out of `StoreListingController` to keep both files well
 * under the 300-line ceiling (docs/13 section 1) — this is a distinct
 * responsibility (a request/approval workflow) sharing the parent's route
 * prefix, not an extension of listing CRUD. Same tenant scoping rule:
 * `merchantId` is always the route's `:tenantId`.
 */
@Controller("api/:tenantId/store/listings")
export class SettlementDecreaseController {
  constructor(
    @Inject(PrincipalService) private readonly principals: PrincipalResolver,
    @Inject(LISTING_REPOSITORY) private readonly listings: ListingRepository,
    @Inject(SETTLEMENT_DECREASE_REQUEST_REPOSITORY)
    private readonly decreaseRequests: SettlementDecreaseRequestRepository,
    @Inject(PDP_CLIENT) private readonly pdp: PdpClient,
  ) {}

  /**
   * `@Authorize` alone is enough here -- unlike `set_settlement_value`, this
   * action carries no materiality condition in the policy
   * (`merchandisers-request-a-settlement-decrease` just checks the role),
   * so the coarse tenant-level check the guard builds is the whole answer.
   * The use-case itself still refuses a change that turns out not to be a
   * material decrease -- this is the ONLY door into
   * `store.settlement_decrease_request`, and it must not become a second,
   * looser way to reprice a listing.
   */
  @Authorize({ kind: "listing", action: "request_settlement_decrease" })
  @Idempotent({ retentionMs: LISTING_WRITE_RETENTION_MS })
  @Post(":listingId/settlement-decrease-requests")
  async propose(
    @Param("tenantId") tenantId: string,
    @Param("listingId") listingId: string,
    @Body() body: ProposeSettlementDecreaseDto,
    @Req() request: FastifyRequest,
  ) {
    const principal = await this.principals.resolve(request);
    const result = await proposeSettlementDecrease(
      this.listings,
      this.decreaseRequests,
      tenantId,
      listingId,
      body.proposedSettlementValueMinor,
      principal.id,
      body.reason,
    );
    if (result.isErr()) throw mapStoreErrorToHttpException(result.error);
    return result.value;
  }

  /**
   * Same two-call shape `StoreListingController.setSettlementValue` uses,
   * for the same reason: `@Authorize` proves this principal may approve
   * settlement decreases for this tenant AT ALL, but
   * `nobody-approves-their-own-settlement-cut` needs the request's real
   * `requestedBy`, which is only known after a read -- so a second, more
   * specific PDP call carries it for real.
   *
   * The actual refusal of a self-approval is NOT this call: it is the WHERE
   * clause inside `SettlementDecreaseRequestRepository.approve` (docs/13c,
   * "a WHERE clause protects the data"). This PDP call is the boundary
   * check; that WHERE clause is what protects the data if the boundary
   * check is ever wrong.
   */
  @Authorize({ kind: "listing", action: "approve_settlement_decrease" })
  @Idempotent({ retentionMs: LISTING_WRITE_RETENTION_MS })
  @Post(":listingId/settlement-decrease-requests/:requestId/approve")
  async approve(
    @Param("tenantId") tenantId: string,
    @Param("listingId") listingId: string,
    @Param("requestId") requestId: string,
    @Req() request: FastifyRequest,
  ) {
    const principal = await this.principals.resolve(request);

    const pending = await this.decreaseRequests.findById(listingId, requestId);
    if (pending === null) {
      throw mapStoreErrorToHttpException({
        type: "settlement_decrease_request_not_found",
        requestId,
      });
    }

    const authz = await this.pdp.requireAction(
      principal,
      {
        kind: "listing",
        id: listingId,
        attr: {
          businessId: tenantId,
          requestedBy: pending.requestedBy,
          approvalState: pending.state,
        },
      },
      "approve_settlement_decrease",
    );
    if (authz.isErr()) throw mapAuthzErrorToHttpException(authz.error);

    const result = await approveSettlementDecrease(
      this.listings,
      this.decreaseRequests,
      tenantId,
      listingId,
      requestId,
      principal.id,
    );
    if (result.isErr()) throw mapStoreErrorToHttpException(result.error);
    return result.value;
  }
}
