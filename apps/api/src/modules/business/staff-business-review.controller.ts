import { Body, Controller, Get, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { Region } from "@yourtal/contracts/region";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import { Idempotent, NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { ONBOARDING_RETENTION_MS } from "../../shared/idempotency/retention";
import { StaffAction, setStaffAuditContext } from "../staff/staff-action.decorator";
import {
  ApproveBusinessKybDto,
  ReinstateBusinessDto,
  RejectBusinessKybDto,
  SuspendBusinessDto,
} from "./dto/staff-business-review.schema";
import { STAFF_BUSINESS_REVIEW_REPOSITORY } from "./persistence/staff-business-review.repository";
import type { StaffBusinessReviewRepository } from "./persistence/staff-business-review.repository";
import { mapBusinessErrorToHttpException } from "./to-http-exception";
import {
  approveBusinessKyb,
  getBusinessForStaff,
  listBusinessesForStaff,
  reinstateBusiness,
  rejectBusinessKyb,
  suspendBusiness,
} from "./use-cases/staff-business-review.use-cases";

const LIST_LIMIT_DEFAULT = 25;
const LIST_LIMIT_MAX = 100;

/**
 * TASKS.md 9.3.a: the staff console's Businesses zone -- search/list every
 * business with its KYB status, review one, approve/reject its KYB (sets
 * `business_accounts.is_verified`), suspend/reinstate it. Every business is
 * reachable regardless of caller region -- staff cross regions by design
 * (`business.yaml`'s `f2-region-wall` scopes only to `user`/`business_user`).
 */
@Controller("api/staff/businesses")
export class StaffBusinessReviewController {
  constructor(
    private readonly principals: AsyncPrincipalResolver,
    @Inject(STAFF_BUSINESS_REVIEW_REPOSITORY)
    private readonly businesses: StaffBusinessReviewRepository,
  ) {}

  @StaffAction("business.list")
  @Authorize({ kind: "business", action: "view" })
  @NotValueMoving("A read.")
  @Get()
  async list(@Query() query: Record<string, string | undefined>) {
    const limit = Math.min(
      LIST_LIMIT_MAX,
      Math.max(1, Number(query["limit"] ?? LIST_LIMIT_DEFAULT) || LIST_LIMIT_DEFAULT),
    );
    const offset = Math.max(0, Number(query["offset"] ?? 0) || 0);
    const region = query["region"] === "AU" || query["region"] === "ID" ? query["region"] : null;
    const search =
      query["search"] === undefined || query["search"].trim() === "" ? null : query["search"].trim();
    const result = await listBusinessesForStaff(this.businesses, {
      search,
      region: region as Region | null,
      limit,
      offset,
    });
    if (result.isErr()) throw mapBusinessErrorToHttpException(result.error);
    return result.value;
  }

  @StaffAction("business.view")
  @Authorize({
    kind: "business",
    action: "view",
    idFrom: (req) => (req.params as Record<string, string>)["businessId"] ?? "",
    attrsFrom: (req) => ({ businessId: (req.params as Record<string, string>)["businessId"] }),
  })
  @NotValueMoving("A read.")
  @Get(":businessId")
  async detail(@Param("businessId") businessId: string) {
    const result = await getBusinessForStaff(this.businesses, businessId);
    if (result.isErr()) throw mapBusinessErrorToHttpException(result.error);
    return result.value;
  }

  @StaffAction("business.kyb.approve")
  @Authorize({
    kind: "kyb_document",
    action: "approve",
    idFrom: (req) => (req.params as Record<string, string>)["businessId"] ?? "",
    attrsFrom: (req) => ({ businessId: (req.params as Record<string, string>)["businessId"] }),
  })
  @Idempotent({ retentionMs: ONBOARDING_RETENTION_MS })
  @Post(":businessId/kyb/approve")
  async approveKyb(
    @Param("businessId") businessId: string,
    @Body() body: ApproveBusinessKybDto,
    @Req() request: FastifyRequest,
  ) {
    const principal = await this.principals.resolve(request);
    const result = await approveBusinessKyb(this.businesses, businessId, principal.id);
    if (result.isErr()) throw mapBusinessErrorToHttpException(result.error);
    setStaffAuditContext(request, {
      targetKind: "business",
      targetId: businessId,
      region: result.value.region,
      reason: body.reason,
    });
    return result.value;
  }

  @StaffAction("business.kyb.reject")
  @Authorize({
    kind: "kyb_document",
    action: "reject",
    idFrom: (req) => (req.params as Record<string, string>)["businessId"] ?? "",
    attrsFrom: (req) => ({ businessId: (req.params as Record<string, string>)["businessId"] }),
  })
  @Idempotent({ retentionMs: ONBOARDING_RETENTION_MS })
  @Post(":businessId/kyb/reject")
  async rejectKyb(
    @Param("businessId") businessId: string,
    @Body() body: RejectBusinessKybDto,
    @Req() request: FastifyRequest,
  ) {
    const principal = await this.principals.resolve(request);
    const result = await rejectBusinessKyb(this.businesses, businessId, principal.id);
    if (result.isErr()) throw mapBusinessErrorToHttpException(result.error);
    setStaffAuditContext(request, {
      targetKind: "business",
      targetId: businessId,
      region: result.value.region,
      reason: body.reason,
    });
    return result.value;
  }

  @StaffAction("business.suspend")
  @Authorize({
    kind: "business",
    action: "suspend",
    idFrom: (req) => (req.params as Record<string, string>)["businessId"] ?? "",
    attrsFrom: (req) => ({ businessId: (req.params as Record<string, string>)["businessId"] }),
  })
  @Idempotent({ retentionMs: ONBOARDING_RETENTION_MS })
  @Post(":businessId/suspend")
  async suspend(
    @Param("businessId") businessId: string,
    @Body() body: SuspendBusinessDto,
    @Req() request: FastifyRequest,
  ) {
    const principal = await this.principals.resolve(request);
    const result = await suspendBusiness(this.businesses, businessId, principal.id, body.reason);
    if (result.isErr()) throw mapBusinessErrorToHttpException(result.error);
    setStaffAuditContext(request, {
      targetKind: "business",
      targetId: businessId,
      region: result.value.region,
      reason: body.reason,
    });
    return result.value;
  }

  @StaffAction("business.reinstate")
  @Authorize({
    kind: "business",
    action: "reinstate",
    idFrom: (req) => (req.params as Record<string, string>)["businessId"] ?? "",
    attrsFrom: (req) => ({ businessId: (req.params as Record<string, string>)["businessId"] }),
  })
  @Idempotent({ retentionMs: ONBOARDING_RETENTION_MS })
  @Post(":businessId/reinstate")
  async reinstate(
    @Param("businessId") businessId: string,
    @Body() body: ReinstateBusinessDto,
    @Req() request: FastifyRequest,
  ) {
    const principal = await this.principals.resolve(request);
    const result = await reinstateBusiness(this.businesses, businessId, principal.id);
    if (result.isErr()) throw mapBusinessErrorToHttpException(result.error);
    setStaffAuditContext(request, {
      targetKind: "business",
      targetId: businessId,
      region: result.value.region,
      reason: body.reason,
    });
    return result.value;
  }
}
