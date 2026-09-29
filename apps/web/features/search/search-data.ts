import "server-only";

import { searchResponseSchema, type SearchResponse } from "@yourtal/contracts/feed";
import { apiFetch, type ApiResult } from "@/lib/api/api-fetch";

/**
 * 11.7.b's data-access seam — `GET /api/search?q=` (7.7.c, already built:
 * `apps/api/src/modules/feed/feed.controller.ts`'s `searchAll`), region- and
 * audience-walled server-side (`resolveCatalogueScope`, the same rule
 * `store-data.ts`'s own catalogue read is walled by) — this file passes the
 * query through and nothing else.
 */
export function search(query: string): Promise<ApiResult<SearchResponse>> {
  return apiFetch(`/api/search?q=${encodeURIComponent(query)}`, searchResponseSchema);
}
