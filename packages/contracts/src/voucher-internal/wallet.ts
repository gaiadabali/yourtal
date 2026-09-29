import { z } from "zod";
import { minorUnitsSchema } from "../money/money";
import { currencySchema } from "../money/money-value";
import { partialRedemptionPolicySchema } from "../listing/listing";
import { voucherLifecycleStateSchema, voucherVoidReasonSchema } from "../voucher/voucher-lifecycle";

/**
 * TASKS.md 1.2.b's wallet reads, widened by 4.8.c.
 *
 * `get`/`listForUser` used to return `Reservation` (id, listing, saga,
 * state) — enough to track a reservation through the burn saga, nothing to
 * *show* a viewer. This is `services/voucher`'s own real read:
 * `lifecycleState` is the engine's actual state (`lifecycle.State` —
 * `GetOwnedVoucher`'s `owner_id = $2` means only active/held/redeemed/
 * expired/voided can ever come back here, never minted/allocated), and the
 * display fields are the voucher's own denormalized copy of what a listing
 * carries (`voucher.vouchers`, `docs/17` §3: a voucher must stay honourable
 * offline, so nothing here is looked up from a listing that may have
 * changed since).
 *
 * `reserve`/`activate` (the checkout saga) still return `Reservation` —
 * unrelated read, unrelated caller, no reason to widen what it never asked
 * for.
 */
export const walletVoucherRowSchema = z.object({
  voucherId: z.uuid(),
  listingId: z.uuid(),
  sagaId: z.string().min(1),
  /** The old 3-bucket collapse (reserved/activated/released) — unchanged, for whatever still reads it. */
  state: z.enum(["reserved", "activated", "released"]),
  lifecycleState: voucherLifecycleStateSchema,
  voidReason: voucherVoidReasonSchema.nullable(),
  merchantName: z.string(),
  title: z.string(),
  currency: currencySchema,
  faceValueMinor: minorUnitsSchema,
  /** Partial redemption (docs/09 §8.2's balance_carrying) is a fact ABOUT this number, not a state of its own. */
  remainingValueMinor: minorUnitsSchema,
  partialRedemptionPolicy: partialRedemptionPolicySchema,
  expiresAt: z.iso.datetime(),
  /** `null` for a voucher minted before locations existed (pre-20260919000009). */
  location: z.object({ name: z.string(), address: z.string(), district: z.string() }).nullable(),
});
export type WalletVoucherRow = z.infer<typeof walletVoucherRowSchema>;

export const listForUserRequestSchema = z.object({
  userId: z.uuid(),
  limit: z.number().int().positive().max(100).default(20),
  startingAfter: z.uuid().optional(),
});
export type ListForUserRequest = z.infer<typeof listForUserRequestSchema>;

export const listForUserResultSchema = z.object({
  vouchers: z.array(walletVoucherRowSchema),
  hasMore: z.boolean(),
});
export type ListForUserResult = z.infer<typeof listForUserResultSchema>;

export const getVoucherRequestSchema = z.object({
  voucherId: z.uuid(),
  ownerId: z.uuid(),
});
export type GetVoucherRequest = z.infer<typeof getVoucherRequestSchema>;
