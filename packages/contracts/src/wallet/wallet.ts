import { z } from "zod";
import { pointsSchema } from "../money/money";
import { regionSchema } from "../region/region";
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

/** A held voucher (4.8.a). Its listing's words and value come from the store. */
export const walletVoucherSchema = z.object({
  voucherId: z.uuid(),
  listingId: z.uuid(),
  state: z.enum(["reserved", "activated", "released"]),
});
export type WalletVoucher = z.infer<typeof walletVoucherSchema>;

export const walletVoucherPageSchema = z.object({
  vouchers: z.array(walletVoucherSchema),
  hasMore: z.boolean(),
});
export type WalletVoucherPage = z.infer<typeof walletVoucherPageSchema>;

/** A short-lived QR token for showing a voucher at the counter. */
export const walletQrSchema = z.object({
  voucherId: z.uuid(),
  token: z.string().min(1),
  expiresAt: z.iso.datetime(),
});
export type WalletQr = z.infer<typeof walletQrSchema>;
