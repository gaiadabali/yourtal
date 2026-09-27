import { BadRequestException, Controller, Get, Inject, Param, Query, Req } from "@nestjs/common";
import { NotFoundException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { regionSchema } from "@yourtal/contracts/region";
import { PublicRoute } from "../../shared/authz/authorize.decorator";
import { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { resolveCatalogueScope } from "./catalogue-scope";
import { browseListingsQuerySchema, toBrowseFilter } from "./dto/browse-listings-query";
import { LISTING_REPOSITORY } from "./persistence/listing.repository";
import type { ListingRepository } from "./persistence/listing.repository";
import { browseListings } from "./use-cases/browse-listings.use-case";
import { getListing } from "./use-cases/get-listing.use-case";

/**
 * The public catalogue: Store browse and offer detail
 * (`apps/web/features/store`, `apps/web/features/burn`). No `:tenantId` — a
 * customer browses across every merchant, but every read is still
 * region- and audience-walled (F2, 7.4.d -- reopened 2026-09-27).
 *
 * `@PublicRoute` rather than `@Authorize`: this route is reachable both
 * signed in and anonymous, and docs/17 has no consumer-facing `listing_view`
 * resource kind (the way `campaign_view` exists opposite `campaign`) to ask
 * a real PDP question with -- see the ticket report. Adding one is a
 * policy-repo decision outside this module's path allowlist, not a call
 * this controller should make unilaterally. That does NOT mean the session
 * is ignored, which is what tripped 7.4.e's own Check the first time: this
 * controller resolves whatever principal IS there (`AsyncPrincipalResolver`,
 * same as `CampaignController`'s `watch_open` route reads through
 * `@Authorize`) and uses it -- see `catalogue-scope.ts` for the actual rule.
 */
@Controller("api/store/listings")
export class StoreCatalogueController {
  constructor(
    @Inject(LISTING_REPOSITORY) private readonly listings: ListingRepository,
    private readonly principals: AsyncPrincipalResolver,
  ) {}

  @PublicRoute(
    "The store catalogue is public browse, same shape as campaign_view's watch_open for " +
      "anonymous viewers. Only `active` listings are ever returned -- see ListingRepository.",
  )
  @NotValueMoving("A read.")
  @Get()
  async browse(
    @Query() query: Record<string, string | string[] | undefined>,
    @Req() request: FastifyRequest,
  ) {
    const parsed = browseListingsQuerySchema.parse(query);
    const principal = await this.principals.resolve(request);
    const scope = resolveCatalogueScope(principal, parsed.region);

    if (scope.kind === "anonymous_region_required") {
      throw new BadRequestException({
        code: "region_required",
        message: "an anonymous request must state a region query param",
      });
    }
    if (scope.kind === "region_mismatch") {
      // Empty, not an error: a signed-in AU caller asking for `?region=ID`
      // is not confused about syntax, just looking at a region they are not
      // in -- the same "show nothing" a wrong district or price band gets.
      return { object: "list", data: [], has_more: false, url: "/api/store/listings" };
    }

    const result = await browseListings(
      this.listings,
      toBrowseFilter(parsed, { region: scope.region, audiences: scope.audiences }),
    );
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
  async get(
    @Param("listingId") listingId: string,
    @Query("region") regionParam: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const queryRegion = regionParam === undefined ? undefined : regionSchema.parse(regionParam);
    const principal = await this.principals.resolve(request);
    const scope = resolveCatalogueScope(principal, queryRegion);

    if (scope.kind === "anonymous_region_required") {
      throw new BadRequestException({
        code: "region_required",
        message: "an anonymous request must state a region query param",
      });
    }
    // A region mismatch 404s exactly like "wrong audience" and "does not
    // exist" below -- distinguishing any of them discloses that a listing
    // outside this caller's own region or audience exists at all.
    if (scope.kind === "region_mismatch") {
      throw new NotFoundException("No such listing.");
    }

    const result = await getListing(this.listings, listingId);
    if (
      result.isErr() ||
      result.value.region !== scope.region ||
      !scope.audiences.includes(result.value.audience)
    ) {
      throw new NotFoundException("No such listing.");
    }
    return result.value;
  }
}
