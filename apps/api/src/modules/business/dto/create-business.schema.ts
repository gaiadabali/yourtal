import { z } from "zod";
import { businessRoleSchema, businessHandleSchema } from "@yourtal/contracts/business";
import { regionSchema } from "@yourtal/contracts/region";
import { createZodDto } from "nestjs-zod";

/**
 * The relationships a business may hold (advertiser/supplier/redeemer) come
 * straight from `@yourtal/contracts/business` — docs/17 section 2 defines
 * this set once and this ticket does not get to redefine it. Everything else
 * here is onboarding-specific and lives in `apps/api` because
 * `packages/contracts` does not model a business's members, billing contact
 * or KYB documents yet (flagged in the ticket report).
 */
export const createBusinessSchema = z
  .object({
    legalName: z.string().min(1).max(160),
    displayName: z.string().min(1).max(120),
    district: z.string().min(1).max(60),
    roles: z.array(businessRoleSchema).min(1),
    logoUrl: z.url().nullable().default(null),
    // `currency` is NOT a body field — it is entirely determined by
    // `region` (`REGION_CONFIG[region].currency`, F2), so asking the caller
    // to also name it would just be a second, potentially-mismatched copy of
    // a fact `region` already states. TASKS.md 1.1.a.
    region: regionSchema,
    handle: businessHandleSchema,
    coverUrl: z.url().nullable().default(null),
  })
  .refine((value) => new Set(value.roles).size === value.roles.length, {
    message: "roles must not contain duplicates",
    path: ["roles"],
  });

export type CreateBusinessRequest = z.infer<typeof createBusinessSchema>;

export class CreateBusinessDto extends createZodDto(createBusinessSchema) {}
