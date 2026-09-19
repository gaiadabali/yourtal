import { createZodDto } from "nestjs-zod";
import { billingContactSchema } from "@yourtal/contracts/business/billing-contact";
import type { z } from "zod";

export const setBillingContactSchema = billingContactSchema.omit({
  businessId: true,
  updatedAt: true,
});

export type SetBillingContactRequest = z.infer<typeof setBillingContactSchema>;

export class SetBillingContactDto extends createZodDto(setBillingContactSchema) {}
