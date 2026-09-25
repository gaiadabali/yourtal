import { z } from "zod";
import { pointsSchema } from "../money/money";
import { regionSchema } from "../region/region";

/** TASKS.md 1.2.a's earning-and-spending group. */

/** F12's holdback-by-trust-tier table. Demo viewer accounts are tier 3. */
export const trustTierSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
export type TrustTier = z.infer<typeof trustTierSchema>;

/**
 * F12 default holdback hours, indexed by trust tier — 72/48/24/0. A fixed
 * constant here until 1.2.f's `platform.region_setting` makes it a per-region
 * value `ledger-internal.getSettings` can read instead (that task is a
 * separate agent's; this is the value it will eventually override).
 */
export const DEFAULT_HOLDBACK_HOURS_BY_TIER: Readonly<Record<TrustTier, number>> = {
  0: 72,
  1: 48,
  2: 24,
  3: 0,
};

export const grantKindSchema = z.enum(["campaign", "streak", "receipt", "goodwill"]);
export type GrantKind = z.infer<typeof grantKindSchema>;

/**
 * apps/api's signed attestation of one completed reward session (4.4.c,
 * EW-12). The ledger pays only a completion it verifies, and computes the
 * points from the terms version it names (4.4.a-b). Signed by
 * `signRewardAttestation` in apps/api's ledger client.
 */
export const rewardAttestationSchema = z.object({
  sessionId: z.string().min(1),
  termsVersion: z.number().int().min(1),
  /** RFC3339 in whole seconds, UTC: `2026-09-26T10:00:00Z`. */
  completedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
  asked: z.number().int().min(0),
  correct: z.number().int().min(0),
  signature: z.string().regex(/^[0-9a-f]{64}$/),
});
export type RewardAttestation = z.infer<typeof rewardAttestationSchema>;

export const grantRewardRequestSchema = z.object({
  campaignId: z.uuid(),
  userId: z.uuid(),
  region: regionSchema,
  points: pointsSchema,
  trustTier: trustTierSchema,
  idempotencyKey: z.string().min(1),
  /** The reward session's hold (`hold` at session start), which this grant consumes (4.4.e). */
  holdId: z.string().min(1).optional(),
  attestation: rewardAttestationSchema,
});
export type GrantRewardRequest = z.infer<typeof grantRewardRequestSchema>;

/** `streak`, `receipt` and `goodwill` grants are marketing-funded, never a partner's allocation. */
export const grantActionRequestSchema = z.object({
  kind: z.enum(["streak", "receipt", "goodwill"]),
  userId: z.uuid(),
  region: regionSchema,
  points: pointsSchema,
  trustTier: trustTierSchema,
  idempotencyKey: z.string().min(1),
});
export type GrantActionRequest = z.infer<typeof grantActionRequestSchema>;

export const grantSchema = z.object({
  grantId: z.string().min(1),
  kind: grantKindSchema,
  userId: z.uuid(),
  region: regionSchema,
  points: pointsSchema,
  /** Available immediately for tier 3, otherwise now + the tier's holdback. */
  unlockAt: z.iso.datetime(),
  grantedAt: z.iso.datetime(),
});
export type Grant = z.infer<typeof grantSchema>;

export const burnForVoucherRequestSchema = z.object({
  userId: z.uuid(),
  listingId: z.uuid(),
  points: pointsSchema,
  sagaId: z.string().min(1),
});
export type BurnForVoucherRequest = z.infer<typeof burnForVoucherRequestSchema>;

export const burnSchema = z.object({
  sagaId: z.string().min(1),
  userId: z.uuid(),
  listingId: z.uuid(),
  points: pointsSchema,
  state: z.enum(["burned", "reinstated"]),
  burnedAt: z.iso.datetime(),
});
export type Burn = z.infer<typeof burnSchema>;
