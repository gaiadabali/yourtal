import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import {
  listingCategorySchema,
  listingStatusSchema,
  partialRedemptionPolicySchema,
} from "@yourtal/contracts/listing";
import { idrMinorUnitsSchema, pointsSchema } from "@yourtal/contracts/money";

/**
 * `merchantId` is the route's `:tenantId`, never a body field — same rule
 * `create-business.schema.ts` follows for the caller becoming the owner: a
 * tenant a client can choose in the body is a tenant a client can choose to
 * be.
 *
 * `priceInPoints` IS a body field, not computed here. The store module
 * cannot derive it (see `store.module.ts`'s doc comment and the ticket
 * report) — a caller supplies the already-priced value, which today can only
 * come from a human copying a mock or a not-yet-built pricing-engine call.
 * This is the seam named explicitly rather than hidden behind a formula this
 * module has no grant to compute.
 */
export const createListingSchema = z
  .object({
    merchantName: z.string().min(1).max(120),
    title: z.string().min(1).max(140),
    description: z.string().min(1).max(500),
    category: listingCategorySchema,
    locationIds: z.array(z.uuid()).min(1),
    faceValueIdr: idrMinorUnitsSchema,
    settlementValueIdr: idrMinorUnitsSchema,
    priceInPoints: pointsSchema,
    stockTotal: z.number().int().positive(),
    transferable: z.boolean(),
    partialRedemptionPolicy: partialRedemptionPolicySchema,
    minimumSpendIdr: idrMinorUnitsSchema.nullable().default(null),
    expiresAt: z.iso.datetime(),
    status: listingStatusSchema,
    perUserLimit: z.number().int().positive().optional(),
  })
  .refine((value) => value.settlementValueIdr <= value.faceValueIdr, {
    message: "settlementValueIdr cannot exceed faceValueIdr",
    path: ["settlementValueIdr"],
  })
  .refine(
    (value) =>
      (value.partialRedemptionPolicy === "minimum_spend") === (value.minimumSpendIdr !== null),
    {
      message: "minimumSpendIdr must be set if and only if the policy is minimum_spend",
      path: ["minimumSpendIdr"],
    },
  );

export type CreateListingRequest = z.infer<typeof createListingSchema>;

export class CreateListingDto extends createZodDto(createListingSchema) {}
