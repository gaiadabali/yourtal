import { z } from "zod";

/**
 * `GET /api/dev/inbox`'s response shape (1.6.b). One entry per
 * `platform.sim_outbox` row — see that migration's own header for why the
 * table exists at all: "everything external is a simulated driver" (red
 * line 11) means a reviewer has to be able to read what would have gone
 * out, not just trust that it didn't error.
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
  createdAt: z.iso.datetime(),
});

export const devInboxResponseSchema = z.object({
  entries: z.array(devInboxEntrySchema),
});

export type DevInboxEntry = z.infer<typeof devInboxEntrySchema>;
export type DevInboxResponse = z.infer<typeof devInboxResponseSchema>;
