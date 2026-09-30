import * as z from "zod";
import { minorUnitsSchema } from "../money/money";
import { currencySchema } from "../money/money-value";
import { regionSchema } from "../region/region";

/**
 * 13.20: the voucher service's gift routes (`/internal/v1/gifts*`). apps/api
 * has already checked both people are verified adults; the service enforces
 * the voucher's own rules and answers a refusal with one of these codes.
 */
export const VOUCHER_GIFT_ERROR_CODES = [
  "not_unused",
  "not_transferable",
  "already_gifted",
  "holdback",
  "velocity_capped",
  "region_mismatch",
  "gift_to_self",
  "not_pending",
  "window_closed",
  "not_found",
  "unavailable",
] as const;
export const voucherGiftErrorCodeSchema = z.enum(VOUCHER_GIFT_ERROR_CODES);
export type VoucherGiftErrorCode = z.infer<typeof voucherGiftErrorCodeSchema>;

export const voucherGiftErrorSchema = z.object({
  code: voucherGiftErrorCodeSchema,
  message: z.string().min(1),
});
export type VoucherGiftError = z.infer<typeof voucherGiftErrorSchema>;

export const voucherGiftStateSchema = z.enum(["pending", "accepted", "returned"]);
export type VoucherGiftState = z.infer<typeof voucherGiftStateSchema>;

export const giftVoucherRequestSchema = z.object({
  voucherId: z.uuid(),
  senderId: z.uuid(),
  recipientId: z.uuid(),
  recipientRegion: regionSchema,
});
export type GiftVoucherRequest = z.infer<typeof giftVoucherRequestSchema>;

/** One gift. `voucherId` is the reminted voucher; `sourceVoucherId` the voided one. */
export const voucherGiftSchema = z.object({
  giftId: z.uuid(),
  sourceVoucherId: z.uuid(),
  voucherId: z.uuid(),
  senderId: z.uuid(),
  recipientId: z.uuid(),
  region: regionSchema,
  state: voucherGiftStateSchema,
  createdAt: z.iso.datetime(),
  /** The end of the recipient's acceptance window. */
  expiresAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  title: z.string(),
  merchantName: z.string(),
  currency: currencySchema,
  faceValueMinor: minorUnitsSchema,
  voucherExpiresAt: z.iso.datetime(),
});
export type VoucherGift = z.infer<typeof voucherGiftSchema>;

export const listGiftsRequestSchema = z.object({
  userId: z.uuid(),
  limit: z.number().int().positive().max(100).optional(),
});
export type ListGiftsRequest = z.infer<typeof listGiftsRequestSchema>;

export const listGiftsResultSchema = z.object({ gifts: z.array(voucherGiftSchema) });
export type ListGiftsResult = z.infer<typeof listGiftsResultSchema>;

export const resolveGiftRequestSchema = z.object({
  giftId: z.uuid(),
  recipientId: z.uuid(),
});
export type ResolveGiftRequest = z.infer<typeof resolveGiftRequestSchema>;
