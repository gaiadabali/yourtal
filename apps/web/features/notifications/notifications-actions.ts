"use server";

import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiResult } from "@/lib/api/api-fetch";
import {
  notificationMarkReadResponseSchema,
  type NotificationMarkReadResponse,
} from "@yourtal/contracts/me/notification";

/**
 * `PATCH /api/me/notifications/:id/read` (5.5.b). Plain `ApiResult`, same
 * "client leaves call this directly and reads `.ok`" convention
 * `me-actions.ts` documents — the bell keeps its own optimistic local state
 * rather than a full navigation on every read.
 */
export async function markNotificationReadAction(
  id: number,
): Promise<ApiResult<NotificationMarkReadResponse>> {
  return apiFetch(`/api/me/notifications/${String(id)}/read`, notificationMarkReadResponseSchema, {
    method: "PATCH",
  });
}
