import * as z from "zod";
import { VOUCHER_GIFT_BLOCKS } from "./gift-block";
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
/**
 * Why a voucher cannot be gifted or listed for a charity: spent, expired or
 * mid-redemption (`not_unused`), a listing that forbids it (`not_transferable`),
 * or already passed on once, by a gift or an auction win (`received_as_gift`).
 */
export const voucherGiftBlockSchema = z.enum(VOUCHER_GIFT_BLOCKS);
export type VoucherGiftBlock = z.infer<typeof voucherGiftBlockSchema>;

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
  /** 13.20: transferable, unused, unexpired and not itself received as a gift. */
  giftable: z.boolean().optional(),
  /** The first rule that stops a gift or a charity listing, in the order the service checks them; absent when `giftable`. */
  giftBlock: voucherGiftBlockSchema.optional(),
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
