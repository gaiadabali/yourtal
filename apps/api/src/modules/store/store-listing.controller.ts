import { Body, Controller, Get, Inject, Param, Patch, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { PdpClient } from "@yourtal/authz/pdp-client";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { mapAuthzErrorToHttpException } from "../../shared/authz/authz-error.mapper";
import { Idempotent, NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { PrincipalService } from "../../shared/authz/principal.service";
import { PDP_CLIENT } from "../../shared/pdp/pdp-client.module";
import { CreateListingDto } from "./dto/create-listing.schema";
import { EditListingDto } from "./dto/edit-listing.schema";
import { SetSettlementValueDto } from "./dto/set-settlement-value.schema";
import { isMaterialSettlementDecrease } from "./material-settlement-decrease";
import { LISTING_PRICE_REVISION_REPOSITORY } from "./persistence/listing-price-revision.repository";
import type { ListingPriceRevisionRepository } from "./persistence/listing-price-revision.repository";
import { LISTING_REPOSITORY } from "./persistence/listing.repository";
import type { ListingRepository } from "./persistence/listing.repository";
import { LISTING_WRITE_RETENTION_MS } from "./retention";
import { mapStoreErrorToHttpException } from "./to-http-exception";
import { createListing } from "./use-cases/create-listing.use-case";
import { editListing } from "./use-cases/edit-listing.use-case";
import { getMyListing } from "./use-cases/get-my-listing.use-case";
import { listMyListings } from "./use-cases/list-my-listings.use-case";
import { setListingLifecycle } from "./use-cases/set-listing-lifecycle.use-case";
import { setSettlementValue } from "./use-cases/set-settlement-value.use-case";

/**
 * The merchant's own Inventory zone (docs/17 section 2). Every method follows
 * the three-step shape every controller in this app uses: resolve the
 * principal, ask the PDP one question (`@Authorize`, enforced by `PdpGuard`),
 * call one use-case.
 *
 * `merchantId` is always the route's `:tenantId`, never a body field — the
 * same rule `CreateBusinessController` states for ownership: a tenant a
 * client can name in a payload is a tenant a client can choose to be.
 */
@Controller("api/:tenantId/store/listings")
export class StoreListingController {
  constructor(
    private readonly principals: PrincipalService,
    @Inject(LISTING_REPOSITORY) private readonly listings: ListingRepository,
    @Inject(LISTING_PRICE_REVISION_REPOSITORY)
    private readonly priceRevisions: ListingPriceRevisionRepository,
    @Inject(PDP_CLIENT) private readonly pdp: PdpClient,
  ) {}

  @Authorize({ kind: "listing", action: "create" })
  @Idempotent({ retentionMs: LISTING_WRITE_RETENTION_MS })
  @Post()
  async create(@Param("tenantId") tenantId: string, @Body() body: CreateListingDto) {
    const result = await createListing(this.listings, tenantId, {
      merchantName: body.merchantName,
      title: body.title,
      description: body.description,
      category: body.category,
      locationIds: body.locationIds,
      faceValueIdr: body.faceValueIdr,
      settlementValueIdr: body.settlementValueIdr,
      priceInPoints: body.priceInPoints,
      stockTotal: body.stockTotal,
      transferable: body.transferable,
      partialRedemptionPolicy: body.partialRedemptionPolicy,
      minimumSpendIdr: body.minimumSpendIdr,
      expiresAt: body.expiresAt,
      status: body.status,
      perUserLimit: body.perUserLimit,
    });
    if (result.isErr()) throw mapStoreErrorToHttpException(result.error);
    return result.value;
  }

  @Authorize({ kind: "listing", action: "view" })
  @NotValueMoving("A read.")
  @Get()
  async list(@Param("tenantId") tenantId: string) {
    const result = await listMyListings(this.listings, tenantId);
    if (result.isErr()) throw mapStoreErrorToHttpException(result.error);
    return { listings: result.value };
  }

  @Authorize({ kind: "listing", action: "view" })
  @NotValueMoving("A read.")
  @Get(":listingId")
  async get(@Param("tenantId") tenantId: string, @Param("listingId") listingId: string) {
    const result = await getMyListing(this.listings, tenantId, listingId);
    if (result.isErr()) throw mapStoreErrorToHttpException(result.error);
    return result.value;
  }

  @Authorize({ kind: "listing", action: "edit" })
  @NotValueMoving("Title, description, stock and policy fields -- no money or lifecycle field.")
  @Patch(":listingId")
  async edit(
    @Param("tenantId") tenantId: string,
    @Param("listingId") listingId: string,
    @Body() body: EditListingDto,
  ) {
    const result = await editListing(this.listings, tenantId, listingId, body);
    if (result.isErr()) throw mapStoreErrorToHttpException(result.error);
    return result.value;
  }

  /**
   * `@Authorize` here only proves this principal may touch settlement values
   * AT ALL -- it cannot know whether THIS change is material, because that
   * needs the listing's current value and `attrsFrom` runs synchronously
   * against the request alone (see `material-settlement-decrease.ts`). So a
   * SECOND, more specific PDP call runs below, once the current value is
   * known, carrying `isMaterialSettlementDecrease` for real. `listing.yaml`
   * denies `set_settlement_value` to everyone once that is true -- a
   * material cut is refused HERE outright. Its only path forward is
   * `SettlementDecreaseController.propose` (YT-0575): a different action,
   * `request_settlement_decrease`, that records a pending request rather
   * than applying anything.
   */
  @Authorize({ kind: "listing", action: "set_settlement_value" })
  @Idempotent({ retentionMs: LISTING_WRITE_RETENTION_MS })
  @Post(":listingId/settlement-value")
  async setSettlementValue(
    @Param("tenantId") tenantId: string,
    @Param("listingId") listingId: string,
    @Body() body: SetSettlementValueDto,
    @Req() request: FastifyRequest,
  ) {
    const principal = this.principals.resolve(request);

    const current = await getMyListing(this.listings, tenantId, listingId);
    if (current.isErr()) throw mapStoreErrorToHttpException(current.error);

    const material = isMaterialSettlementDecrease(
      current.value.settlementValueIdr,
      body.newSettlementValueIdr,
    );
    const authz = await this.pdp.requireAction(
      principal,
      {
        kind: "listing",
        id: listingId,
        attr: { businessId: tenantId, isMaterialSettlementDecrease: material },
      },
      "set_settlement_value",
    );
    if (authz.isErr()) throw mapAuthzErrorToHttpException(authz.error);

    const result = await setSettlementValue(
      this.listings,
      tenantId,
      listingId,
      body.newSettlementValueIdr,
      principal.id,
      body.reason,
    );
    if (result.isErr()) throw mapStoreErrorToHttpException(result.error);
    return result.value;
  }

  @Authorize({ kind: "listing", action: "view" })
  @NotValueMoving("A read.")
  @Get(":listingId/price-revisions")
  async priceRevisionsFor(
    @Param("tenantId") tenantId: string,
    @Param("listingId") listingId: string,
  ) {
    // Tenant-scoped through the listing, not the revision table directly --
    // a revision row carries no merchant_id of its own, so ownership is
    // proven by first confirming this listing is one of this tenant's.
    const owned = await getMyListing(this.listings, tenantId, listingId);
    if (owned.isErr()) throw mapStoreErrorToHttpException(owned.error);
    return { revisions: await this.priceRevisions.listForListing(listingId) };
  }

  @Authorize({ kind: "listing", action: "edit" })
  @NotValueMoving("Hides a listing from the public catalogue; nothing of value moves.")
  @Post(":listingId/pause")
  async pause(@Param("tenantId") tenantId: string, @Param("listingId") listingId: string) {
    const result = await setListingLifecycle(this.listings, tenantId, listingId, "paused");
    if (result.isErr()) throw mapStoreErrorToHttpException(result.error);
    return result.value;
  }

  @Authorize({ kind: "listing", action: "edit" })
  @NotValueMoving("Returns a paused listing to the public catalogue; nothing of value moves.")
  @Post(":listingId/resume")
  async resume(@Param("tenantId") tenantId: string, @Param("listingId") listingId: string) {
    const result = await setListingLifecycle(this.listings, tenantId, listingId, "active");
    if (result.isErr()) throw mapStoreErrorToHttpException(result.error);
    return result.value;
  }

  @Authorize({ kind: "listing", action: "archive" })
  @NotValueMoving("Terminal removal from the catalogue; nothing of value moves.")
  @Post(":listingId/retire")
  async retire(@Param("tenantId") tenantId: string, @Param("listingId") listingId: string) {
    const result = await setListingLifecycle(this.listings, tenantId, listingId, "retired");
    if (result.isErr()) throw mapStoreErrorToHttpException(result.error);
    return result.value;
  }
}
