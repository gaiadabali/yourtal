import { Body, Controller, Inject, Param, Post } from "@nestjs/common";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { CreateListingImageUploadUrlDto } from "./dto/create-listing-image-upload-url.schema";
import { LISTING_IMAGE_STORAGE } from "./object-storage/listing-image-storage";
import type { ListingImageStorage } from "./object-storage/listing-image-storage";

/**
 * The picture on a reward card. Minting an upload URL is a step towards creating a listing, so
 * it asks the same `create` question of the PDP (owner, admin and merchandiser, region-walled
 * like every other listing action) rather than inventing a capability of its own. The business
 * is always the route's `:tenantId`, which also names the folder the file lands in.
 */
@Controller("api/:tenantId/store/listing-images")
export class StoreListingImageController {
  constructor(@Inject(LISTING_IMAGE_STORAGE) private readonly storage: ListingImageStorage) {}

  @NotValueMoving(
    "Each call mints a fresh, single-use object key; there is nothing to replay onto.",
  )
  @Authorize({ kind: "listing", action: "create" })
  @Post("upload-url")
  async createUploadUrl(
    @Param("tenantId") tenantId: string,
    @Body() body: CreateListingImageUploadUrlDto,
  ) {
    return this.storage.createUploadUrl({ businessId: tenantId, contentType: body.contentType });
  }
}
