import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import {
  listingCategorySchema,
  listingStatusSchema,
  partialRedemptionPolicySchema,
} from "@yourtal/contracts/listing";
import { idrMinorUnitsSchema } from "@yourtal/contracts/money";

/**
 * Every field optional (a PATCH), and deliberately WITHOUT
 * `settlementValueIdr` or `priceInPoints` — repricing goes through
 * `set-settlement-value.schema.ts` only, so the one action that must be
 * audit-logged (docs/17 section 2.1) cannot be reached by a plain edit.
 */
export const editListingSchema = z.object({
  title: z.string().min(1).max(140).optional(),
  description: z.string().min(1).max(500).optional(),
  category: listingCategorySchema.optional(),
  stockTotal: z.number().int().positive().optional(),
  stockRemaining: z.number().int().min(0).optional(),
  transferable: z.boolean().optional(),
  partialRedemptionPolicy: partialRedemptionPolicySchema.optional(),
  minimumSpendIdr: idrMinorUnitsSchema.nullable().optional(),
  expiresAt: z.iso.datetime().optional(),
  status: listingStatusSchema.optional(),
  perUserLimit: z.number().int().positive().nullable().optional(),
});

export type EditListingRequest = z.infer<typeof editListingSchema>;

export class EditListingDto extends createZodDto(editListingSchema) {}
