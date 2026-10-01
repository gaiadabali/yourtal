"use server";

import { revalidatePath } from "next/cache";
import { listingSchema } from "@yourtal/contracts/listing";
import { apiFetch } from "@/lib/api/api-fetch";

export interface ListingTagsPatch {
  contentCategory: string;
  tags: string[];
  /** 13.20.e: whether the voucher can be gifted or listed in a charity auction. */
  transferable: boolean;
}

export type ListingTagsResult =
  | { ok: true; tags: string[]; contentCategory: string; transferable: boolean }
  | { ok: false; message: string };

/** 13.11.a/13.20.e: `PATCH /api/:tenantId/store/listings/:listingId` with category, tags and transferable. */
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
  return {
    ok: true,
    tags: result.data.tags,
    contentCategory: result.data.contentCategory,
    transferable: result.data.transferable,
  };
}
