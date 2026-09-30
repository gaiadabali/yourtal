import * as z from "zod";
import { minorUnitsSchema } from "../money/money";
import { currencySchema } from "../money/money-value";

/**
 * TASKS.md 1.2.b's device-authorized redemption. Both operations assert the
 * calling device belongs to the merchant the voucher names — a device
 * credential authorized for merchant A must never authorize or capture a
 * voucher issued by merchant B.
 */

/**
 * TASKS.md 8.2.a (Area C, added to this Area A file with the same
 * disclosed-minimal-edit reasoning `shared/authz/device-credential-
 * verifier.ts` records for 8.1.b): a read-only preview, so a cashier can see
 * the merchant/offer/remaining value before committing to
 * `authorizeAsDeviceRequestSchema`, which places a hold. No new storage —
 * `services/voucher`'s `lookupAsDevice` handler reads the exact row
 * `authorizeAsDevice` already loads, just without moving it to `held`.
 */
export const lookupAsDeviceRequestSchema = z.object({
  voucherCode: z.string().min(1),
  merchantId: z.uuid(),
});
export type LookupAsDeviceRequest = z.infer<typeof lookupAsDeviceRequestSchema>;

export const voucherPreviewSchema = z.object({
  voucherId: z.uuid(),
  merchantName: z.string().min(1),
  offerTitle: z.string().min(1),
  remainingValueMinor: minorUnitsSchema,
  currency: currencySchema,
  partialRedemptionPolicy: z.string().min(1),
});
export type VoucherPreview = z.infer<typeof voucherPreviewSchema>;

export const authorizeAsDeviceRequestSchema = z.object({
  voucherCode: z.string().min(1),
  deviceId: z.string().min(1),
  merchantId: z.uuid(),
  /** Only for a `balance_carries` voucher; omitted spends the full remaining value. */
  amountMinor: minorUnitsSchema.optional(),
  currency: currencySchema,
});
export type AuthorizeAsDeviceRequest = z.infer<typeof authorizeAsDeviceRequestSchema>;

export const authorizationSchema = z.object({
  authorizationId: z.string().min(1),
  voucherId: z.uuid(),
  amountMinor: minorUnitsSchema,
  currency: currencySchema,
  expiresAt: z.iso.datetime(),
});
export type Authorization = z.infer<typeof authorizationSchema>;

export const captureAsDeviceRequestSchema = z.object({
  authorizationId: z.string().min(1),
  deviceId: z.string().min(1),
  merchantId: z.uuid(),
});
export type CaptureAsDeviceRequest = z.infer<typeof captureAsDeviceRequestSchema>;

export const captureSchema = z.object({
  captureId: z.string().min(1),
  voucherId: z.uuid(),
  amountMinor: minorUnitsSchema,
  currency: currencySchema,
  capturedAt: z.iso.datetime(),
});
export type Capture = z.infer<typeof captureSchema>;
