import { z } from "zod";
import { pointsSchema } from "../money/money";
import { regionSchema } from "../region/region";
import { historyEntrySchema } from "../ledger-internal/wallet";
import { trustTierSchema } from "../ledger-internal/rewards";

/** TASKS.md 9.4: `apps/api/src/modules/staff/**`'s users-and-support screen. */

/** `GET /api/staff/users`. Search by email or user id; both optional, but one is required. */
export const staffUserSearchQuerySchema = z
  .object({
    email: z.string().min(1).optional(),
    userId: z.uuid().optional(),
    region: regionSchema.optional(),
  })
  .refine((query) => query.email !== undefined || query.userId !== undefined, {
    message: "search needs an email or a user id",
  });
export type StaffUserSearchQuery = z.infer<typeof staffUserSearchQuerySchema>;

export const staffUserSummarySchema = z.object({
  userId: z.uuid(),
  email: z.string().nullable(),
  region: regionSchema,
  trustTier: trustTierSchema,
  isSuspended: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type StaffUserSummary = z.infer<typeof staffUserSummarySchema>;

export const staffUserSearchResultSchema = z.array(staffUserSummarySchema);
export type StaffUserSearchResult = z.infer<typeof staffUserSearchResultSchema>;

/** `GET /api/staff/users/:userId`: the summary plus the ledger's own balance. */
export const staffUserDetailSchema = staffUserSummarySchema.extend({
  availablePoints: pointsSchema,
  pendingPoints: pointsSchema,
});
export type StaffUserDetail = z.infer<typeof staffUserDetailSchema>;

/** `GET /api/staff/users/:userId/ledger`: the same shape `LedgerInternalClient.history` returns. */
export const staffUserLedgerHistorySchema = z.array(historyEntrySchema);
export type StaffUserLedgerHistory = z.infer<typeof staffUserLedgerHistorySchema>;

/**
 * `POST /api/staff/users/:userId/suspend`, TASKS.md 9.4.b. Escrows the
 * account's available AND pending points (never zeroes a balance) and sets
 * `identity.user_profile.suspended_at`.
 */
export const suspendUserRequestSchema = z.object({ reason: z.string().min(1) });
export type SuspendUserRequest = z.infer<typeof suspendUserRequestSchema>;

export const suspendUserResultSchema = z.object({
  userId: z.uuid(),
  suspendedAt: z.iso.datetime(),
  /** `null` when there was nothing to escrow -- a fresh, zero-balance account. */
  escrowId: z.string().min(1).nullable(),
  escrowedPoints: pointsSchema,
});
export type SuspendUserResult = z.infer<typeof suspendUserResultSchema>;

/** `POST /api/staff/users/:userId/release`, TASKS.md 9.4.b: reverses a suspension. */
export const releaseUserResultSchema = z.object({
  userId: z.uuid(),
  releasedPoints: pointsSchema,
});
export type ReleaseUserResult = z.infer<typeof releaseUserResultSchema>;

/**
 * `POST /api/staff/users/:userId/goodwill`, TASKS.md 9.4.c. Marketing-funded
 * (K6), within the F12 per-case limit read fresh from the region settings
 * store -- see `region-settings-reader.ts` and `user_account.yaml`'s
 * `goodwill-stays-under-the-ceiling` rule. A reason is mandatory.
 */
export const goodwillRequestSchema = z.object({
  points: pointsSchema,
  reason: z.string().min(1),
});
export type GoodwillRequest = z.infer<typeof goodwillRequestSchema>;

export const goodwillResultSchema = z.object({
  grantId: z.string().min(1),
  points: pointsSchema,
  unlockAt: z.iso.datetime(),
});
export type GoodwillResult = z.infer<typeof goodwillResultSchema>;

/**
 * `POST /api/staff/users/:userId/trust-tier`, TASKS.md 9.4.d. Tier 3 is
 * staff-set only (F12) -- the same closed union `GrantActionRequest` uses.
 * Never shown to the user.
 */
export const setTrustTierRequestSchema = z.object({
  trustTier: trustTierSchema,
  reason: z.string().min(1),
});
export type SetTrustTierRequest = z.infer<typeof setTrustTierRequestSchema>;

export const setTrustTierResultSchema = z.object({
  userId: z.uuid(),
  trustTier: trustTierSchema,
});
export type SetTrustTierResult = z.infer<typeof setTrustTierResultSchema>;
