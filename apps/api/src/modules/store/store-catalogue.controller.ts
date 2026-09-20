import { Controller, Get, Inject, Param, Query } from "@nestjs/common";
import { NotFoundException } from "@nestjs/common";
import { PublicRoute } from "../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { browseListingsQuerySchema, toBrowseFilter } from "./dto/browse-listings-query";
import { LISTING_REPOSITORY } from "./persistence/listing.repository";
import type { ListingRepository } from "./persistence/listing.repository";
import { browseListings } from "./use-cases/browse-listings.use-case";
import { getListing } from "./use-cases/get-listing.use-case";

/**
 * The public catalogue: Store browse and offer detail
 * (`apps/web/features/store`, `apps/web/features/burn`). No `:tenantId` — a
 * customer browses across every merchant.
 *
 * `@PublicRoute` rather than `@Authorize`: this is exactly the "public
 * catalogue page" `authorize.decorator.ts` names as the intended use of that
 * escape hatch. docs/17 has no consumer-facing `listing_view` resource kind
 * (the way `campaign_view` exists opposite `campaign`) — see the ticket
 * report. Adding one is a policy-repo decision outside this module's path
 * allowlist, not a call this controller should make unilaterally.
 */
@Controller("api/store/listings")
export class StoreCatalogueController {
  constructor(@Inject(LISTING_REPOSITORY) private readonly listings: ListingRepository) {}

  @PublicRoute(
    "The store catalogue is public browse, same shape as campaign_view's watch_open for " +
      "anonymous viewers. Only `active` listings are ever returned -- see ListingRepository.",
  )
  @NotValueMoving("A read.")
  @Get()
  async browse(@Query() query: Record<string, string | string[] | undefined>) {
    const parsed = browseListingsQuerySchema.parse(query);
    const result = await browseListings(this.listings, toBrowseFilter(parsed));
    if (result.isErr()) throw new Error(result.error.cause);
    return {
      object: "list",
      data: result.value.listings,
      has_more: result.value.hasMore,
      url: "/api/store/listings",
    };
  }

  @PublicRoute("Offer detail is the same public catalogue surface as browse, one listing.")
  @NotValueMoving("A read.")
  @Get(":listingId")
  async get(@Param("listingId") listingId: string) {
    const result = await getListing(this.listings, listingId);
    if (result.isErr()) {
      // 404 whether the listing does not exist or is not active, deliberately
      // -- same reasoning as `CampaignController.get`: distinguishing them
      // discloses that a paused/retired listing exists.
      throw new NotFoundException("No such listing.");
    }
    return result.value;
  }
}
