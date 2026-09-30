import * as z from "zod";
import { pointsSchema } from "../money/money";
import { regionSchema } from "../region/region";

/**
 * TASKS.md 10.2.d: points-expiring warnings. Same list-then-acknowledge
 * shape releases.ts's own POINTS_UNLOCKED_QUEUE uses — the ledger runs its
 * expiry sweep on its own loop (10.2.a) and writes one
 * `ledger.points_expiry_notice` row per (account, milestone) it discovers;
 * the worker lists the ones nobody has announced, sends one event each,
 * then acknowledges them.
 */

export const POINTS_EXPIRING_QUEUE = "ledger.points_expiring";

export const milestoneDaysSchema = z.union([z.literal(30), z.literal(7)]);
export type MilestoneDays = z.infer<typeof milestoneDaysSchema>;

export const expiryNoticeSchema = z.object({
  accountId: z.string().min(1),
  userId: z.string().min(1),
  region: regionSchema,
  milestoneDays: milestoneDaysSchema,
  expiringAt: z.iso.datetime(),
  /** The balance this notice is warning about, read fresh at announce time. */
  points: pointsSchema,
});
export type ExpiryNotice = z.infer<typeof expiryNoticeSchema>;

export const unnotifiedPointsExpiryRequestSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
});
export type UnnotifiedPointsExpiryRequest = z.infer<typeof unnotifiedPointsExpiryRequestSchema>;

/** Oldest notice first. */
export const unnotifiedPointsExpirySchema = z.object({
  notices: z.array(expiryNoticeSchema),
});
export type UnnotifiedPointsExpiry = z.infer<typeof unnotifiedPointsExpirySchema>;

const acknowledgedNoticeSchema = z.object({
  accountId: z.string().min(1),
  milestoneDays: milestoneDaysSchema,
  expiringAt: z.iso.datetime(),
});

export const pointsExpiryNotifiedRequestSchema = z.object({
  notices: z.array(acknowledgedNoticeSchema).min(1).max(500),
});
export type PointsExpiryNotifiedRequest = z.infer<typeof pointsExpiryNotifiedRequestSchema>;

export const pointsExpiryNotifiedSchema = z.object({
  acknowledged: z.number().int().min(0),
});
export type PointsExpiryNotified = z.infer<typeof pointsExpiryNotifiedSchema>;

/** The `ledger.points_expiring` job's data. At-least-once: dedupe on `idempotencyKey`. */
export const pointsExpiringEventSchema = expiryNoticeSchema.extend({
  idempotencyKey: z.string().min(1),
});
export type PointsExpiringEvent = z.infer<typeof pointsExpiringEventSchema>;
