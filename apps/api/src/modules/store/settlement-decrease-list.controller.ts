import { Controller, Get, Inject, Param, Query } from "@nestjs/common";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { listSettlementDecreasesQuerySchema } from "./dto/list-settlement-decreases-query";
import { SETTLEMENT_DECREASE_REQUEST_REPOSITORY } from "./persistence/settlement-decrease-request.repository";
import type { SettlementDecreaseRequestRepository } from "./persistence/settlement-decrease-request.repository";
import { mapStoreErrorToHttpException } from "./to-http-exception";
import { listSettlementDecreases } from "./use-cases/list-settlement-decreases.use-case";

/**
 * 7.4.g (requested by D/7.8): the business's own pending S-decrease
 * proposals across every listing, so Studio's inventory screen can show
 * them for approval -- today only the per-listing propose/approve routes
 * exist (`SettlementDecreaseController`). A separate controller because
 * `GET api/:tenantId/store/settlement-decreases` has no `:listingId` in its
 * path at all, unlike every route that controller owns.
 *
 * `@Authorize({kind: "listing", action: "view"})`: the same read-gate
 * `priceRevisionsFor` uses for a cross-cutting listing read -- no new
 * Cerbos surface needed.
 */
@Controller("api/:tenantId/store/settlement-decreases")
export class SettlementDecreaseListController {
  constructor(
    @Inject(SETTLEMENT_DECREASE_REQUEST_REPOSITORY)
    private readonly decreaseRequests: SettlementDecreaseRequestRepository,
  ) {}

  @Authorize({ kind: "listing", action: "view" })
  @NotValueMoving("A read.")
  @Get()
  async list(
    @Param("tenantId") tenantId: string,
    @Query() query: Record<string, string | string[] | undefined>,
  ) {
    listSettlementDecreasesQuerySchema.parse(query);
    const result = await listSettlementDecreases(this.decreaseRequests, tenantId);
    if (result.isErr()) throw mapStoreErrorToHttpException(result.error);
    return { requests: result.value };
  }
}
