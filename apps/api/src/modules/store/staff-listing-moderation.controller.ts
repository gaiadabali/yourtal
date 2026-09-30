import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { Inject } from "@nestjs/common";
import { listPendingListingModerationResponseSchema } from "@yourtal/contracts/staff/moderation";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { Idempotent, NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { StaffAction, setStaffAuditContext } from "../staff/staff-action.decorator";
import { LISTING_WRITE_RETENTION_MS } from "./retention";
import { LISTING_REPOSITORY } from "./persistence/listing.repository";
import type { ListingRepository } from "./persistence/listing.repository";
import {
  ApproveListingModerationDto,
  RejectListingModerationDto,
} from "./dto/staff-listing-moderation.schema";
import { mapStoreErrorToHttpException } from "./to-http-exception";
import {
  approveListingModeration,
  listListingModerationQueue,
  rejectListingModeration,
} from "./use-cases/staff-listing-moderation.use-cases";

/**
 * TASKS.md 9.2.a: the listing half of the staff moderation queue. Only a
 * listing the automated screen flagged (an `adult_only` `contentCategory`,
 * per 1.1.d -- `DrizzleListingRepository`'s own `initialLifecycleState`)
 * ever reaches `pending_review`; every other listing is `active` from
 * creation, unchanged from before this task.
 *
 * `listing.yaml`'s `approve_listing`/`reject_listing` carry no per-request
 * condition (unlike `moderation_item`'s reason requirement), so a single
 * `@Authorize` with the real action is enough here -- no second, explicit
 * PDP call needed.
 */
@Controller("api/staff/moderation/listings")
export class StaffListingModerationController {
  constructor(@Inject(LISTING_REPOSITORY) private readonly listings: ListingRepository) {}

  @StaffAction("listing_moderation.list")
  @Authorize({ kind: "listing", action: "view" })
  @NotValueMoving("A read.")
  @Get()
  async list() {
    const result = await listListingModerationQueue(this.listings);
    if (result.isErr()) throw mapStoreErrorToHttpException(result.error);
    return listPendingListingModerationResponseSchema.parse({ listings: result.value });
  }

  @StaffAction("listing_moderation.approve")
  @Authorize({
    kind: "listing",
    action: "approve_listing",
    idFrom: (request) => paramOf(request, "listingId"),
  })
  @Idempotent({ retentionMs: LISTING_WRITE_RETENTION_MS })
  @Post(":listingId/approve")
  async approve(
    @Param("listingId") listingId: string,
    @Body() body: ApproveListingModerationDto,
    @Req() request: FastifyRequest,
  ) {
    const result = await approveListingModeration(this.listings, listingId, {
      audience: body.audience,
      contentCategory: body.contentCategory,
    });
    if (result.isErr()) throw mapStoreErrorToHttpException(result.error);
    setStaffAuditContext(request, {
      targetKind: "listing",
      targetId: listingId,
      region: result.value.region,
      reason: body.reason,
      detail: { audience: result.value.audience, contentCategory: result.value.contentCategory },
    });
    return result.value;
  }

  @StaffAction("listing_moderation.reject")
  @Authorize({
    kind: "listing",
    action: "reject_listing",
    idFrom: (request) => paramOf(request, "listingId"),
  })
  @Idempotent({ retentionMs: LISTING_WRITE_RETENTION_MS })
  @Post(":listingId/reject")
  async reject(
    @Param("listingId") listingId: string,
    @Body() body: RejectListingModerationDto,
    @Req() request: FastifyRequest,
  ) {
    const result = await rejectListingModeration(this.listings, listingId, body.reason);
    if (result.isErr()) throw mapStoreErrorToHttpException(result.error);
    setStaffAuditContext(request, {
      targetKind: "listing",
      targetId: listingId,
      region: result.value.region,
      reason: body.reason,
    });
    return result.value;
  }
}

function paramOf(request: FastifyRequest, name: string): string {
  const params: unknown = request.params;
  if (typeof params !== "object" || params === null) return "";
  const value: unknown = Reflect.get(params, name);
  return typeof value === "string" ? value : "";
}
