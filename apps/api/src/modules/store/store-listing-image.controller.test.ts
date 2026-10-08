import { describe, expect, it, vi } from "vitest";
import { createListingImageUploadUrlRequestSchema } from "@yourtal/contracts/listing/image";
import type { ListingImageStorage } from "./object-storage/listing-image-storage";
import { StoreListingImageController } from "./store-listing-image.controller";

const TENANT = "00000000-0000-4000-8000-000000000a01";

function controller() {
  const createUploadUrl = vi.fn<ListingImageStorage["createUploadUrl"]>().mockResolvedValue({
    uploadUrl: "https://upload.example/put",
    imageUrl: "https://site.example/media/posters/listings/x.png",
    expiresAt: "2026-10-08T00:15:00.000Z",
  });
  return { controller: new StoreListingImageController({ createUploadUrl }), createUploadUrl };
}

describe("StoreListingImageController", () => {
  it("mints the URL for the route's business, never one named in the body", async () => {
    const { controller: subject, createUploadUrl } = controller();
    const result = await subject.createUploadUrl(TENANT, { contentType: "image/png" });
    expect(createUploadUrl).toHaveBeenCalledWith({ businessId: TENANT, contentType: "image/png" });
    expect(result.imageUrl).toContain("/media/posters/listings/");
  });

  it("accepts only web picture types", () => {
    for (const contentType of ["image/jpeg", "image/png", "image/webp"]) {
      expect(createListingImageUploadUrlRequestSchema.safeParse({ contentType }).success).toBe(
        true,
      );
    }
    for (const contentType of ["image/svg+xml", "image/gif", "text/html", "application/pdf", ""]) {
      expect(createListingImageUploadUrlRequestSchema.safeParse({ contentType }).success).toBe(
        false,
      );
    }
  });
});
