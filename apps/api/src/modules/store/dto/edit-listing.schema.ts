import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import {
  listingCategorySchema,
  listingStatusSchema,
  partialRedemptionPolicySchema,
} from "@yourtal/contracts/listing";
import { minorUnitsSchema } from "@yourtal/contracts/money";
import { audienceSchema } from "@yourtal/contracts/campaign";
import { contentCategorySchema } from "@yourtal/jurisdiction/content-category";

/**
 * Every field optional (a PATCH), and deliberately WITHOUT
 * `settlementValueMinor` or `priceInPoints` — repricing goes through
 * `set-settlement-value.schema.ts` only, so the one action that must be
 * audit-logged (docs/17 section 2.1) cannot be reached by a plain edit.
 *
 * `stockRemaining` is gone too (7.4.c): it is now a read-only projection of
 * unallocated vouchers (`state = 'minted'`), never a merchant-editable
 * number. `stockTotal` stays -- the merchant's own declared cap.
 */
export const editListingSchema = z.object({
  title: z.string().min(1).max(140).optional(),
  description: z.string().min(1).max(500).optional(),
  category: listingCategorySchema.optional(),
  stockTotal: z.number().int().positive().optional(),
  transferable: z.boolean().optional(),
  partialRedemptionPolicy: partialRedemptionPolicySchema.optional(),
  minimumSpendMinor: minorUnitsSchema.nullable().optional(),
  expiresAt: z.iso.datetime().optional(),
  status: listingStatusSchema.optional(),
  perUserLimit: z.number().int().positive().nullable().optional(),
  // 12.4.c (F83): re-checked against the same 1.1.d policy `create` already
  // enforces (`edit-listing.use-case.ts`'s own `categoryRefusal` call) --
  // never applied unchecked.
  contentCategory: contentCategorySchema.optional(),
  audience: audienceSchema.optional(),
});

export type EditListingRequest = z.infer<typeof editListingSchema>;

export class EditListingDto extends createZodDto(editListingSchema) {}
