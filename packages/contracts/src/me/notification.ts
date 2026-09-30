import * as z from "zod";
import { regionSchema } from "../region/region";

/**
 * TASKS.md 5.5.b's `GET /api/me/notifications` / `PATCH .../:id/read`
 * (`apps/api/src/modules/me/notifications.controller.ts`), consumed here for
 * 11.7.a's top-bar bell. Both routes predate this contract file (their own
 * exemption is recorded in `openapi/route-drift.test.ts`); this only gives
 * the shape a name so the web side stops re-deriving it ad hoc.
 */
export const notificationSchema = z.object({
  id: z.number().int(),
  userId: z.string().min(1),
  region: regionSchema,
  category: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationListResponseSchema = z.object({
  notifications: z.array(notificationSchema),
});
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;

export const notificationMarkReadResponseSchema = z.object({ read: z.literal(true) });
export type NotificationMarkReadResponse = z.infer<typeof notificationMarkReadResponseSchema>;
