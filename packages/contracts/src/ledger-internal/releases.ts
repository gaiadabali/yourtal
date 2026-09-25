import { z } from "zod";
import { pointsSchema } from "../money/money";
import { regionSchema } from "../region/region";

/**
 * Holdback release notices (4.4.g). The ledger releases held grants on its
 * own loop; the worker lists the releases nobody has announced, sends one
 * `ledger.points_unlocked` event each, then acknowledges them. A grant with
 * no holdback (trust tier 3) was never locked and is never listed.
 */

/** The pg-boss queue the worker sends each unlock to. */
export const POINTS_UNLOCKED_QUEUE = "ledger.points_unlocked";

export const releaseSchema = z.object({
  grantId: z.string().min(1),
  userId: z.string().min(1),
  region: regionSchema,
  points: pointsSchema,
  unlockedAt: z.iso.datetime(),
});
export type Release = z.infer<typeof releaseSchema>;

export const unnotifiedReleasesRequestSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
});
export type UnnotifiedReleasesRequest = z.infer<typeof unnotifiedReleasesRequestSchema>;

/** Oldest release first. */
export const unnotifiedReleasesSchema = z.object({
  releases: z.array(releaseSchema),
});
export type UnnotifiedReleases = z.infer<typeof unnotifiedReleasesSchema>;

export const releasesNotifiedRequestSchema = z.object({
  grantIds: z.array(z.string().min(1)).min(1).max(500),
});
export type ReleasesNotifiedRequest = z.infer<typeof releasesNotifiedRequestSchema>;

/** How many were newly recorded; a repeat or an unknown id counts 0. */
export const releasesNotifiedSchema = z.object({
  acknowledged: z.number().int().min(0),
});
export type ReleasesNotified = z.infer<typeof releasesNotifiedSchema>;

/**
 * The `ledger.points_unlocked` job's data. At-least-once: a consumer
 * dedupes on `idempotencyKey`. Points only: no rate, no cash.
 */
export const pointsUnlockedEventSchema = releaseSchema.extend({
  idempotencyKey: z.string().min(1),
});
export type PointsUnlockedEvent = z.infer<typeof pointsUnlockedEventSchema>;
