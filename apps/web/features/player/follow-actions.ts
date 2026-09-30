import * as z from "zod";
import { apiFetch } from "@/lib/api/api-fetch";

const followsListSchema = z.object({
  follows: z.array(z.object({ businessId: z.uuid() })),
});

/**
 * 11.5.a/11.5.d: whether the caller already follows this business, for the
 * channel row's and channel page's initial Follow/Following state.
 * Server-only (reads the session cookie via `apiFetch`) — called only from
 * a Server Component. `false` on any read failure (including "not signed
 * in", which this app's watch/channel pages never are, but a failed API
 * call should degrade to "not following" rather than throwing).
 */
export async function isFollowingBusiness(businessId: string): Promise<boolean> {
  const result = await apiFetch("/api/me/follows", followsListSchema);
  if (!result.ok) return false;
  return result.data.follows.some((follow) => follow.businessId === businessId);
}
