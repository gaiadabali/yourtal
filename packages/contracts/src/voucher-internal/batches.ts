import { z } from "zod";
import { minorUnitsSchema } from "../money/money";
import { currencySchema } from "../money/money-value";
import { partialRedemptionPolicySchema } from "../listing/listing";

/** TASKS.md 1.2.b's batch group — YT-0141's two-person-approved issuance batch. */

export const requestBatchRequestSchema = z.object({
  listingId: z.uuid(),
  merchantId: z.uuid(),
  currency: currencySchema,
  faceValueMinor: minorUnitsSchema,
  quantity: z.number().int().positive(),
  partialRedemptionPolicy: partialRedemptionPolicySchema,
  requestedBy: z.string().min(1),
});
export type RequestBatchRequest = z.infer<typeof requestBatchRequestSchema>;

export const batchSchema = z.object({
  batchId: z.string().min(1),
  listingId: z.uuid(),
  merchantId: z.uuid(),
  currency: currencySchema,
  faceValueMinor: minorUnitsSchema,
  quantity: z.number().int().positive(),
  requestedBy: z.string().min(1),
  approvedBy: z.string().min(1).nullable(),
  state: z.enum(["pending", "approved"]),
});
export type Batch = z.infer<typeof batchSchema>;

/** Two-person approval: `approvedBy` must differ from the batch's `requestedBy`. */
export const approveBatchRequestSchema = z.object({
  batchId: z.string().min(1),
  approvedBy: z.string().min(1),
});
export type ApproveBatchRequest = z.infer<typeof approveBatchRequestSchema>;

export type { PartialRedemptionPolicy } from "../listing/listing";
