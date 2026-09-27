import { z } from "zod";
import { minorUnitsSchema } from "../money/money";
import { currencySchema } from "../money/money-value";

/** TASKS.md 8.2.g: `GET /api/:tenantId/studio/redemptions` — recent captures per location and device. */

export const studioRedemptionQuerySchema = z.object({
  locationId: z.uuid().optional(),
  deviceId: z.uuid().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});
export type StudioRedemptionQuery = z.infer<typeof studioRedemptionQuerySchema>;

export const studioRedemptionEntrySchema = z.object({
  captureId: z.string().min(1),
  deviceId: z.uuid(),
  deviceLabel: z.string().min(1),
  locationId: z.uuid(),
  locationName: z.string().min(1),
  voucherId: z.uuid(),
  amountMinor: minorUnitsSchema,
  currency: currencySchema,
  orderRef: z.string().min(1),
  capturedAt: z.iso.datetime(),
});
export type StudioRedemptionEntry = z.infer<typeof studioRedemptionEntrySchema>;

export const studioRedemptionListSchema = z.object({
  entries: z.array(studioRedemptionEntrySchema),
});
export type StudioRedemptionList = z.infer<typeof studioRedemptionListSchema>;
