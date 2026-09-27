import { z } from "zod";
import { listingCategorySchema } from "@yourtal/contracts/listing";
import { regionSchema } from "@yourtal/contracts/region";
import type { Audience } from "@yourtal/contracts/campaign";
import type { Region } from "@yourtal/contracts/region";
import type { BrowseListingsFilter } from "../persistence/listing.repository";

/**
 * The public catalogue's query string (docs/13 section 5: cursor-only
 * pagination, `limit` default 20 cap 100). Parsed with Zod rather than
 * hand-clamped like `CampaignController.list` — this route has five
 * independent filters instead of one `limit`, and a malformed value should
 * be rejected (400) rather than silently substituted, since a caller
 * filtering by `minPoints=-5` almost certainly has a bug worth surfacing.
 *
 * `region` here is OPTIONAL, not the caller's actual filter region (7.4.d,
 * F2, reopened): a signed-in caller's region and audience come from their
 * OWN principal, never the query, and this file has no way to know whether
 * a request is signed in. `store-catalogue.controller.ts` resolves the real
 * principal, decides the EFFECTIVE region/audiences there, and passes them
 * into `toBrowseFilter` explicitly. This schema still requires SOMETHING be
 * present for an anonymous caller -- that check is the controller's too,
 * because it is the one place that knows which case applies.
 */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export const browseListingsQuerySchema = z.object({
  region: regionSchema.optional(),
  category: listingCategorySchema.optional(),
  merchantId: z.uuid().optional(),
  district: z.string().min(1).max(60).optional(),
  q: z.string().min(1).max(200).optional(),
  minPoints: z.coerce.number().int().min(0).optional(),
  maxPoints: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  startingAfter: z.uuid().optional(),
});

export type BrowseListingsQuery = z.infer<typeof browseListingsQuerySchema>;

export function toBrowseFilter(
  query: BrowseListingsQuery,
  effective: { readonly region: Region; readonly audiences: readonly Audience[] },
): BrowseListingsFilter {
  return {
    region: effective.region,
    audiences: effective.audiences,
    category: query.category,
    merchantId: query.merchantId,
    district: query.district,
    search: query.q,
    minPoints: query.minPoints,
    maxPoints: query.maxPoints,
    limit: query.limit,
    startingAfter: query.startingAfter,
  };
}
