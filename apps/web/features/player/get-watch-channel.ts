import "server-only";

import { channelReadResponseSchema, type ChannelReadResponse } from "@yourtal/contracts/feed";
import { apiFetch } from "@/lib/api/api-fetch";

/**
 * 11.5.a/11.5.d: the watch page's channel row (Follow, "more from this
 * channel") and the completion screen's own vouchers both come from the
 * SAME read, `GET /api/channels/by-business/:businessId` — one call gives
 * the channel summary, its still-live campaigns and its own store
 * listings, so `page.tsx` fetches it once and threads it to whichever
 * pieces need it. `null` on any failure (business not found, suspended, or
 * the API being unreachable) rather than throwing — the watch page must
 * still render the player and terms card even if the channel information
 * cannot be read.
 */
export async function getWatchChannel(businessId: string): Promise<ChannelReadResponse | null> {
  const result = await apiFetch(
    `/api/channels/by-business/${businessId}`,
    channelReadResponseSchema,
  );
  return result.ok ? result.data : null;
}
