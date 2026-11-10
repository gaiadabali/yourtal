"use server";

import { economyProposalSchema } from "@yourtal/contracts/staff/economy";
import { apiFetch } from "@/lib/api/api-fetch";

/** What a price button shows: nothing on success, the server's own words on a refusal; `""` when the form was unusable. */
export type ListingPriceActionResult = { ok: true } | { ok: false; message: string };

function regionOrThrow(region: string): "AU" | "ID" {
  if (region !== "AU" && region !== "ID") throw new Error("invalid region");
  return region;
}

async function post(path: string, body: unknown): Promise<ListingPriceActionResult> {
  const result = await apiFetch(path, economyProposalSchema, {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body,
  });
  return result.ok ? { ok: true } : { ok: false, message: result.error.message };
}

/** 2.8.g: proposes a listing's points price, or clearing it (`null`). A reason is required. */
export async function proposeListingPriceAction(
  region: string,
  listingId: string,
  minPricePoints: number | null,
  reason: string,
): Promise<ListingPriceActionResult> {
  const trimmed = reason.trim();
  const priceOk =
    minPricePoints === null || (Number.isInteger(minPricePoints) && minPricePoints >= 1);
  if (trimmed === "" || trimmed.length > 500 || !priceOk) return { ok: false, message: "" };
  return post(`/api/staff/economy/${regionOrThrow(region)}/listing-prices/proposals`, {
    listingId,
    minPricePoints,
    reason: trimmed,
  });
}

/** A second finance person approves; anyone in finance, the proposer included, may decline. */
export async function decideListingPriceAction(
  region: string,
  proposalId: string,
  decision: "approve" | "reject",
): Promise<ListingPriceActionResult> {
  return post(
    `/api/staff/economy/${regionOrThrow(region)}/listing-prices/proposals/${encodeURIComponent(proposalId)}/${decision}`,
    {},
  );
}
