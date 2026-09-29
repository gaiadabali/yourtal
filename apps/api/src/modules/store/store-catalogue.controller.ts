import { BadRequestException, Controller, Get, Inject, Param, Query, Req } from "@nestjs/common";
import { NotFoundException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { PdpClient } from "@yourtal/authz/pdp-client";
import { regionSchema } from "@yourtal/contracts/region";
import { PublicRoute } from "../../shared/authz/authorize.decorator";
import { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import { PDP_CLIENT } from "../../shared/pdp/pdp-client.module";
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
 * signed in and anonymous, and `getListing`'s own region-mismatch branch
 * deliberately 404s rather than 403/401s a caller outside the listing's
 * audience or region -- distinguishing "wrong audience" from "does not
 * exist" discloses that a listing outside this caller's own reach exists at
 * all. `@Authorize`'s `PdpGuard` cannot honour that: a Cerbos DENY there
 * always maps to 403 (401 for anonymous, F30), so `get()` below still asks
 * Cerbos itself -- 12.1.b's `listing.yaml` `consumer-browse-is-audience-gated`
 * rule now answers `browse` for this kind -- but folds a DENY into the same
 * `NotFoundException` the manual scope check above it already throws. That
 * does NOT mean the session is ignored, which is what tripped 7.4.e's own
 * Check the first time: this controller resolves whatever principal IS
 * there (`AsyncPrincipalResolver`, same as `CampaignController`'s
 * `watch_open` route reads through `@Authorize`) and uses it -- see
 * `catalogue-scope.ts` for the list-side rule, which `browse` below now
 * agrees with by construction.
 */
@Controller("api/store/listings")
export class StoreCatalogueController {
  constructor(
    @Inject(LISTING_REPOSITORY) private readonly listings: ListingRepository,
    private readonly principals: AsyncPrincipalResolver,
    @Inject(PDP_CLIENT) private readonly pdp: PdpClient,
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

    // 12.1.b: a second, PDP-backed opinion -- `listing.yaml`'s own
    // `consumer-browse-is-audience-gated` rule, asked directly rather than
    // through `@Authorize` so a DENY still 404s (this class's own doc
    // comment). This is what makes the TS-side scope check above and the
    // policy repo's truth table PROVABLY the same thing on every real
    // request, not just in the parity test that compares them offline.
    const authz = await this.pdp.requireAction(
      principal,
      {
        kind: "listing",
        id: listingId,
        attr: { region: result.value.region, audience: result.value.audience },
      },
      "browse",
    );
    if (authz.isErr()) {
      throw new NotFoundException("No such listing.");
    }
    return result.value;
  }
}
