"use server";

import { revalidatePath } from "next/cache";
import { listingSchema } from "@yourtal/contracts/listing";
import { apiFetch } from "@/lib/api/api-fetch";

export interface ListingTagsPatch {
  contentCategory: string;
  tags: string[];
}

export type ListingTagsResult =
  { ok: true; tags: string[]; contentCategory: string } | { ok: false; message: string };

/** 13.11.a: `PATCH /api/:tenantId/store/listings/:listingId` with the category and tags only. */
export async function updateListingTags(
  businessId: string,
  listingId: string,
  patch: ListingTagsPatch,
): Promise<ListingTagsResult> {
  const result = await apiFetch(
    `/api/${businessId}/store/listings/${encodeURIComponent(listingId)}`,
    listingSchema,
    { method: "PATCH", body: patch },
  );
  if (!result.ok) return { ok: false, message: result.error.message };
  revalidatePath("/studio/inventory");
  return { ok: true, tags: result.data.tags, contentCategory: result.data.contentCategory };
}
