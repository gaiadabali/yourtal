import * as z from "zod";
import { minorUnitsSchema } from "../money/money";
import { currencySchema } from "../money/money-value";

/**
 * TASKS.md 8.2: the counter BFF, called by a paired device only
 * (`StoreDevicePrincipalResolver`, never a session). No offline queue
 * anywhere here (8.2.b) — a lost network is a clear refusal, not a client
 * cache to reconcile later.
 */

/** `POST /api/counter/lookup` — a read-only preview, no hold placed. */
export const counterLookupRequestSchema = z.object({ code: z.string().min(1) });
export type CounterLookupRequest = z.infer<typeof counterLookupRequestSchema>;

export const counterVoucherPreviewSchema = z.object({
  voucherId: z.uuid(),
  merchantName: z.string().min(1),
  offerTitle: z.string().min(1),
  remainingValueMinor: minorUnitsSchema,
  currency: currencySchema,
  partialRedemptionPolicy: z.enum(["single_use", "balance_carrying"]),
});
export type CounterVoucherPreview = z.infer<typeof counterVoucherPreviewSchema>;

/** `POST /api/counter/authorize` — places a 5-minute hold. */
export const counterAuthorizeRequestSchema = z.object({
  code: z.string().min(1),
  amountMinor: minorUnitsSchema.optional(),
  currency: currencySchema,
  orderRef: z.string().min(1),
  orderTotalMinor: minorUnitsSchema,
});
export type CounterAuthorizeRequest = z.infer<typeof counterAuthorizeRequestSchema>;

export const counterAuthorizationSchema = z.object({
  authorizationId: z.string().min(1),
  voucherId: z.uuid(),
  amountMinor: minorUnitsSchema,
  currency: currencySchema,
  expiresAt: z.iso.datetime(),
});
export type CounterAuthorization = z.infer<typeof counterAuthorizationSchema>;

/** `POST /api/counter/capture` — void/refund are never reachable from here (8.2.c). */
export const counterCaptureRequestSchema = z.object({ authorizationId: z.string().min(1) });
export type CounterCaptureRequest = z.infer<typeof counterCaptureRequestSchema>;

export const counterCaptureSchema = z.object({
  captureId: z.string().min(1),
  voucherId: z.uuid(),
  amountMinor: minorUnitsSchema,
  currency: currencySchema,
  capturedAt: z.iso.datetime(),
  orderRef: z.string().min(1),
});
export type CounterCapture = z.infer<typeof counterCaptureSchema>;

/** `GET /api/counter/log` — today's captures at this device only (redemption.yaml's `logScope`). */
export const counterLogEntrySchema = counterCaptureSchema.extend({
  authorizedAt: z.iso.datetime(),
});
export type CounterLogEntry = z.infer<typeof counterLogEntrySchema>;

export const counterLogResultSchema = z.object({ entries: z.array(counterLogEntrySchema) });
export type CounterLogResult = z.infer<typeof counterLogResultSchema>;
