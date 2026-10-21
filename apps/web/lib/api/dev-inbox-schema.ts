import * as z from "zod";

/**
 * `GET /api/dev/inbox`'s response (1.6.b, 5.13.b), restated here the same way
 * `dev-clock-schema.ts` restates `/api/dev/clock`'s, so `apiFetch` validates it.
 * `access` says whose messages these are: `open` (local dev, everyone's),
 * `staff` (everyone's) or `own` (only mail sent to `viewerEmail`).
 */
export const devInboxEntrySchema = z.object({
  id: z.string(),
  boundary: z.enum(["email", "push", "webhook"]),
  region: z.enum(["AU", "ID"]),
  recipient: z.string(),
  category: z.string(),
  subject: z.string().optional(),
  body: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

export const devInboxResponseSchema = z.object({
  access: z.enum(["open", "staff", "own"]),
  viewerEmail: z.string().nullable(),
  entries: z.array(devInboxEntrySchema),
});

export type DevInboxEntry = z.infer<typeof devInboxEntrySchema>;
export type DevInboxResponse = z.infer<typeof devInboxResponseSchema>;
