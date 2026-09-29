import { apiFetch, type ApiResult } from "@/lib/api/api-fetch";
import {
  notificationListResponseSchema,
  type NotificationListResponse,
} from "@yourtal/contracts/me/notification";

/**
 * 11.7.a's read side: `GET /api/me/notifications` (5.5.b), unchanged —
 * this file only gives the web side a named entry point, the same "one
 * data-access seam" convention `wallet-data.ts` documents.
 */
const BELL_LIMIT = 20;

export function getNotifications(): Promise<ApiResult<NotificationListResponse>> {
  return apiFetch(
    `/api/me/notifications?limit=${String(BELL_LIMIT)}`,
    notificationListResponseSchema,
  );
}
