import { z } from "zod";
import { minorUnitsSchema } from "../money/money";
import { currencySchema } from "../money/money-value";

/**
 * TASKS.md 1.2.b's device-authorized redemption. Both operations assert the
 * calling device belongs to the merchant the voucher names — a device
 * credential authorized for merchant A must never authorize or capture a
 * voucher issued by merchant B.
 */

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
