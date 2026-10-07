"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { listingSchema, settlementDecreaseRequestSchema } from "@yourtal/contracts/listing";
import { merchantLocationSchema } from "@yourtal/contracts/listing/merchant-location";
import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiError } from "@/lib/api/api-fetch";
import type { NewListingBody } from "./listing-form";

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

/** Failures reach the client as the API's own `code`, which the screens translate. */
export type InventoryResult<T> = { ok: true; value: T } | { ok: false; code: string };

function failure(error: ApiError): { ok: false; code: string } {
  return { ok: false, code: error.kind === "http" ? error.code : "unavailable" };
}

const settlementChangeSchema = z.object({ previous: listingSchema, updated: listingSchema });

export interface PricedListing {
  title: string;
  priceInPoints: number;
}

export interface NewLocationInput {
  name: string;
  address: string;
  district: string;
}

/** `POST /api/:tenantId/store/locations` (7.4.a). */
export async function createLocationAction(
  businessId: string,
  input: NewLocationInput,
): Promise<InventoryResult<{ name: string }>> {
  const result = await apiFetch(`/api/${businessId}/store/locations`, merchantLocationSchema, {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body: input,
  });
  if (!result.ok) return failure(result.error);
  revalidatePath("/studio/inventory");
  return { ok: true, value: { name: result.data.name } };
}

/** `POST /api/:tenantId/store/listings`. The price in the answer is the platform's, never the form's. */
export async function createListingAction(
  businessId: string,
  body: NewListingBody,
): Promise<InventoryResult<PricedListing>> {
  const result = await apiFetch(`/api/${businessId}/store/listings`, listingSchema, {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body,
  });
  if (!result.ok) return failure(result.error);
  revalidatePath("/studio/inventory");
  return {
    ok: true,
    value: { title: result.data.title, priceInPoints: result.data.priceInPoints },
  };
}

export type SettlementChangeOutcome =
  { kind: "applied"; previousPriceInPoints: number; priceInPoints: number } | { kind: "requested" };

/**
 * A rise in S applies at once (and the server reprices); any cut is filed as
 * a request a second person approves (docs/17 section 2.1). Which one is
 * decided here, against the stored S, never against what the screen showed.
 */
export async function changeSettlementValueAction(
  businessId: string,
  listingId: string,
  newSettlementValueMinor: number,
  reason: string,
): Promise<InventoryResult<SettlementChangeOutcome>> {
  const base = `/api/${businessId}/store/listings/${encodeURIComponent(listingId)}`;
  const current = await apiFetch(base, listingSchema);
  if (!current.ok) return failure(current.error);
  if (newSettlementValueMinor === current.data.settlementValueMinor) {
    return { ok: false, code: "unchanged" };
  }

  if (newSettlementValueMinor < current.data.settlementValueMinor) {
    const proposed = await apiFetch(
      `${base}/settlement-decrease-requests`,
      settlementDecreaseRequestSchema,
      {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: { proposedSettlementValueMinor: newSettlementValueMinor, reason },
      },
    );
    if (!proposed.ok) return failure(proposed.error);
    revalidatePath("/studio/inventory");
    return { ok: true, value: { kind: "requested" } };
  }

  const applied = await apiFetch(`${base}/settlement-value`, settlementChangeSchema, {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body: { newSettlementValueMinor, reason },
  });
  if (!applied.ok) return failure(applied.error);
  revalidatePath("/studio/inventory");
  return {
    ok: true,
    value: {
      kind: "applied",
      previousPriceInPoints: applied.data.previous.priceInPoints,
      priceInPoints: applied.data.updated.priceInPoints,
    },
  };
}

/** The second approver's click: applies the pending cut and reprices. The API refuses the requester. */
export async function approveSettlementDecreaseAction(
  businessId: string,
  listingId: string,
  requestId: string,
): Promise<InventoryResult<{ priceInPoints: number }>> {
  const result = await apiFetch(
    `/api/${businessId}/store/listings/${encodeURIComponent(listingId)}/settlement-decrease-requests/${encodeURIComponent(requestId)}/approve`,
    settlementChangeSchema,
    { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: {} },
  );
  if (!result.ok) return failure(result.error);
  revalidatePath("/studio/inventory");
  return { ok: true, value: { priceInPoints: result.data.updated.priceInPoints } };
}
