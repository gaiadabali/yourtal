import { z } from "zod";
import { pointsSchema } from "../money/money";

/** TASKS.md 1.2.a's users group. */

export const escrowRequestSchema = z.object({
  userId: z.uuid(),
  points: pointsSchema,
  reason: z.string().min(1),
  /** A retry with the same key answers the original escrow. */
  idempotencyKey: z.string().min(1).optional(),
});
export type EscrowRequest = z.infer<typeof escrowRequestSchema>;

export const escrowSchema = z.object({
  escrowId: z.string().min(1),
  userId: z.uuid(),
  points: pointsSchema,
  reason: z.string().min(1),
  state: z.enum(["held", "released"]),
});
export type Escrow = z.infer<typeof escrowSchema>;

export const pendingBucketSchema = z.object({
  points: pointsSchema,
  unlockAt: z.iso.datetime(),
});
export type PendingBucket = z.infer<typeof pendingBucketSchema>;

export const ledgerBalanceSchema = z.object({
  userId: z.uuid(),
  availablePoints: pointsSchema,
  /** One bucket per distinct unlock time still outstanding. */
  pending: z.array(pendingBucketSchema),
  expiringPoints: pointsSchema,
  expiringAt: z.iso.datetime().nullable(),
});
export type LedgerBalance = z.infer<typeof ledgerBalanceSchema>;

export const historyEntryKindSchema = z.enum([
  "grant",
  "burn",
  "escrow",
  "escrow_release",
  "expiry",
  "reinstatement",
]);
export type HistoryEntryKind = z.infer<typeof historyEntryKindSchema>;

export const historyEntrySchema = z.object({
  id: z.string().min(1),
  kind: historyEntryKindSchema,
  points: pointsSchema,
  /** Idempotency key or saga id this entry came from, for support lookups. */
  externalRef: z.string().min(1),
  campaignId: z.uuid().nullable(),
  listingId: z.uuid().nullable(),
  voucherId: z.uuid().nullable(),
  at: z.iso.datetime(),
});
export type LedgerHistoryEntry = z.infer<typeof historyEntrySchema>;

export const historyRequestSchema = z.object({
  userId: z.uuid(),
  limit: z.number().int().positive().max(100).default(20),
  startingAfter: z.string().min(1).optional(),
});
export type HistoryRequest = z.infer<typeof historyRequestSchema>;
