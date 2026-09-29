import "server-only";

import { channelReadResponseSchema, type ChannelReadResponse } from "@yourtal/contracts/feed";
import { apiFetch } from "@/lib/api/api-fetch";

/** 11.5.d: the in-app channel page (`/c/[handle]`) — `GET /api/channels/:handle`. `null` for a bad handle, a suspended business, or an unreachable API. */
export async function getChannelByHandle(handle: string): Promise<ChannelReadResponse | null> {
  const result = await apiFetch(`/api/channels/${handle}`, channelReadResponseSchema);
  return result.ok ? result.data : null;
}
