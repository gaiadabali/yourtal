import "server-only";
// YT-0589: the enforcement this module's doc comment says does not exist.
// Importing this file from a client graph is now a BUILD FAILURE rather
// than a review catch. See apps/web/features/README-server-only.md.

import * as z from "zod";
import type { PublicListing } from "@yourtal/contracts/listing";
import { publicListingSchema } from "@yourtal/contracts/listing";
import { apiFetch, type ApiResult } from "@/lib/api/api-fetch";

/**
 * The Store's single data-access seam (11.6.a, replacing Phase U's
 * mock-only `resolveDataSource`). Every read is a real
 * `GET /api/store/listings*` round trip through `apiFetch` (1.7.a) — no
 * mock branch, mirroring `wallet-data.ts` (6.5) and per Phase 11's "Done
 * when: ...with no mock data".
 *
 * `publicListingSchema`, never `listingSchema`: this is the customer-facing
 * catalogue and must not be able to carry `settlementValueMinor` even by
 * mistake (`listing.ts`'s own docstring on why S stays off any public
 * route). `apps/api/src/modules/store/store-catalogue.controller.ts`
 * already enforces the region/audience wall server-side from the caller's
 * own principal — this module passes no region itself, the same way
 * `wallet-data.ts` never states whose wallet it is asking for.
 */
const browseListingsResponseSchema = z.object({
  object: z.literal("list"),
  data: z.array(publicListingSchema),
  has_more: z.boolean(),
  url: z.string(),
});

// A generous single page rather than cursor pagination: the demo catalogue
// (16 businesses' listings plus the two affordable ones, 7.2.e/8.2.i) fits
// well under this, and the browse grid has no "load more" UI yet.
const BROWSE_LIMIT = 100;

/** All store listings for the caller's own region and audience, unfiltered. */
export function listListings(): Promise<ApiResult<PublicListing[]>> {
  return apiFetch(
    `/api/store/listings?limit=${String(BROWSE_LIMIT)}`,
    browseListingsResponseSchema,
  ).then((result) => (result.ok ? { ok: true, data: result.data.data } : result));
}

/** A single listing for the offer detail page, or `undefined` if no such listing exists (or it is outside the caller's region/audience — the API 404s both alike, YT-0513). */
export async function getListing(listingId: string): Promise<PublicListing | undefined> {
  const result = await apiFetch(
    `/api/store/listings/${encodeURIComponent(listingId)}`,
    publicListingSchema,
  );
  if (result.ok) return result.data;
  if (result.error.kind === "http" && result.error.status === 404) return undefined;
  throw new Error(`GET /api/store/listings/${listingId} failed: ${result.error.message}`);
}
