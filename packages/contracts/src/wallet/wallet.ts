import { z } from "zod";
import { minorUnitsSchema, pointsSchema } from "../money/money";
import { currencySchema } from "../money/money-value";
import { regionSchema } from "../region/region";
import { partialRedemptionPolicySchema } from "../listing/listing";
import { voucherStatusSchema } from "../voucher/voucher";
import { qrTokenWindowSchema } from "../voucher-internal/lifecycle";
import { walletHistoryEntrySchema } from "./wallet-history";

/**
 * `GET /api/wallet` (TASKS.md 4.8.a): what a viewer can spend now, what is
 * still in holdback and when each part unlocks, and what is about to expire.
 * Points only: no rate and no money value (B never reaches a client, 4.9.d).
 */
export const walletPendingSchema = z.object({
  points: pointsSchema,
  unlockAt: z.iso.datetime(),
});
export type WalletPending = z.infer<typeof walletPendingSchema>;

export const walletSummarySchema = z
  .object({
    region: regionSchema,
    availablePoints: pointsSchema,
    pendingPoints: pointsSchema,
    /** One entry per unlock time, soonest first. */
    pending: z.array(walletPendingSchema),
    expiringPoints: pointsSchema,
    expiringAt: z.iso.datetime().nullable(),
    /**
     * 12.2.b: the region's teen daily earn cap (`teen_daily_earn_cap`),
     * present only for a `teen` viewer — an adult's own cap is not this
     * field's concern (no adult-facing meter exists), so it stays absent
     * rather than sent as a number nothing reads. Never hardcoded: read from
     * `platform.region_setting` at request time, same as every other F12
     * economy number.
     */
    dailyCapPoints: pointsSchema.optional(),
  })
  .refine(
    (wallet) => wallet.pendingPoints === wallet.pending.reduce((sum, p) => sum + p.points, 0),
    { message: "pendingPoints is the sum of pending", path: ["pendingPoints"] },
  );
export type WalletSummary = z.infer<typeof walletSummarySchema>;

/** `GET /api/wallet/history`: newest first; pass `nextCursor` back as `startingAfter`. */
export const walletHistoryPageSchema = z.object({
  entries: z.array(walletHistoryEntrySchema),
  nextCursor: z.string().min(1).nullable(),
});
export type WalletHistoryPage = z.infer<typeof walletHistoryPageSchema>;

/**
 * A held voucher (4.8.a). `state` is the ORIGINAL three-bucket collapse
 * (reserved/activated/released), kept byte-for-byte for backward
 * compatibility — `apps/web/features/wallet/wallet-data.ts`'s own schema
 * parses it as a required, non-optional field, so changing its value range
 * would fail every real caller's `safeParse` the day a captured voucher
 * shows up in a read (`invalid_response`, TASKS.md 4.8.c's own finding
 * running the 8.2.e Check on staging).
 *
 * `status` is the NEW, additive field 4.8.c actually asks for: the voucher's
 * real state, derived by `publicVoucherStatusOf` (`voucher-lifecycle.ts`)
 * from `services/voucher`'s own `lifecycleState` — active/redeemed/expired/
 * transferred, the same closed set `voucherSchema.status` already uses
 * elsewhere. `held` maps to `active` and a non-transfer void is `undefined`
 * (omitted) on purpose — see that function's own doc comment: a hold is a
 * fact about a checkout in progress, not about ownership, and a voucher
 * killed by fraud/admin/refund-reversal is not something its own owner
 * necessarily gets an accounting of.
 *
 * Every field below `status` is optional, same convention
 * `wallet-data.ts`'s already-written schema expects: a caller on the OLD
 * contract shape (nothing populated) parses every one of these as
 * `undefined`, not a validation failure.
 */
export const walletVoucherSchema = z.object({
  voucherId: z.uuid(),
  listingId: z.uuid(),
  state: z.enum(["reserved", "activated", "released"]),
  status: voucherStatusSchema.optional(),
  merchantName: z.string().optional(),
  title: z.string().optional(),
  currency: currencySchema.optional(),
  faceValueMinor: minorUnitsSchema.optional(),
  remainingValueMinor: minorUnitsSchema.optional(),
  expiresAt: z.iso.datetime().optional(),
  location: z.object({ name: z.string(), address: z.string(), district: z.string() }).optional(),
  partialRedemptionPolicy: partialRedemptionPolicySchema.optional(),
  /** 13.20: the voucher can be gifted now (holdback and caps are only known on trying). */
  giftable: z.boolean().optional(),
});
export type WalletVoucher = z.infer<typeof walletVoucherSchema>;

export const walletVoucherPageSchema = z.object({
  vouchers: z.array(walletVoucherSchema),
  hasMore: z.boolean(),
});
export type WalletVoucherPage = z.infer<typeof walletVoucherPageSchema>;

/**
 * A short-lived QR token for showing a voucher at the counter. `tokens`
 * (4.8.c) is all 12 five-minute windows the keyring already mints, so an
 * offline-capable caller can cache the rest instead of re-requesting one
 * every 5 minutes — optional, same reason `voucher-internal/lifecycle.ts`'s
 * own `QrToken.tokens` is: the fake client mints only the current window.
 */
export const walletQrSchema = z.object({
  voucherId: z.uuid(),
  token: z.string().min(1),
  expiresAt: z.iso.datetime(),
  tokens: z.array(qrTokenWindowSchema).optional(),
});
export type WalletQr = z.infer<typeof walletQrSchema>;
