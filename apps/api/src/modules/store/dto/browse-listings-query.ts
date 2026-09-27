import { z } from "zod";
import { listingCategorySchema } from "@yourtal/contracts/listing";
import { regionSchema } from "@yourtal/contracts/region";
import type { BrowseListingsFilter } from "../persistence/listing.repository";

/**
 * The public catalogue's query string (docs/13 section 5: cursor-only
 * pagination, `limit` default 20 cap 100). Parsed with Zod rather than
 * hand-clamped like `CampaignController.list` — this route has five
 * independent filters instead of one `limit`, and a malformed value should
 * be rejected (400) rather than silently substituted, since a caller
 * filtering by `minPoints=-5` almost certainly has a bug worth surfacing.
 *
 * `region` is REQUIRED, no default (7.4.d, F2) — this route has no
 * `:tenantId` and no session to read a region from, so the caller (the web
 * app) must state "the path region" itself. `DEFAULT_REGION = "ID"`
 * (docs/audit) is exactly the silent-default failure mode this refuses.
 */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export const browseListingsQuerySchema = z.object({
  region: regionSchema,
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

export function toBrowseFilter(query: BrowseListingsQuery): BrowseListingsFilter {
  return {
    region: query.region,
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
