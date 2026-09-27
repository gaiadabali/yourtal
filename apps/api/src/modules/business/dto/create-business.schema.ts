import { z } from "zod";
import {
  auStateSchema,
  businessRoleSchema,
  businessHandleSchema,
  taxIdKindSchema,
} from "@yourtal/contracts/business";
import { regionSchema } from "@yourtal/contracts/region";
import { createZodDto } from "nestjs-zod";

/**
 * The relationships a business may hold (advertiser/supplier/redeemer) come
 * straight from `@yourtal/contracts/business` — docs/17 section 2 defines
 * this set once and this ticket does not get to redefine it. Everything else
 * here is onboarding-specific and lives in `apps/api` because
 * `packages/contracts` does not model a business's members, billing contact
 * or KYB documents yet (flagged in the ticket report).
 *
 * TASKS.md 7.1.a: tax ID and address are region-specific, and the region is
 * the caller's own choice on this same request — so the cross-field shape
 * (ABN + state/postcode for AU; NIB/NPWP + city for ID) is asserted with a
 * `superRefine` here, at the boundary, rather than left to `businessSchema`'s
 * own refine to catch after the fact.
 */
export const createBusinessSchema = z
  .object({
    legalName: z.string().min(1).max(160),
    displayName: z.string().min(1).max(120),
    taxIdKind: taxIdKindSchema,
    taxIdValue: z.string().min(1).max(32),
    addressState: auStateSchema.nullable().default(null),
    addressPostcode: z
      .string()
      .regex(/^\d{4}$/, "postcode must be 4 digits")
      .nullable()
      .default(null),
    addressCity: z.string().min(1).max(120).nullable().default(null),
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
  })
  .superRefine((value, ctx) => {
    if (value.region === "AU") {
      if (value.taxIdKind !== "ABN") {
        ctx.addIssue({
          code: "custom",
          message: "an AU business's taxIdKind must be ABN",
          path: ["taxIdKind"],
        });
      }
      if (value.addressState === null || value.addressPostcode === null) {
        ctx.addIssue({
          code: "custom",
          message: "an AU business needs addressState and addressPostcode",
          path: ["addressState"],
        });
      }
      if (value.addressCity !== null) {
        ctx.addIssue({
          code: "custom",
          message: "an AU business does not carry addressCity",
          path: ["addressCity"],
        });
      }
    } else {
      if (value.taxIdKind === "ABN") {
        ctx.addIssue({
          code: "custom",
          message: "an ID business's taxIdKind must be NIB or NPWP",
          path: ["taxIdKind"],
        });
      }
      if (value.addressCity === null) {
        ctx.addIssue({
          code: "custom",
          message: "an ID business needs addressCity",
          path: ["addressCity"],
        });
      }
      if (value.addressState !== null || value.addressPostcode !== null) {
        ctx.addIssue({
          code: "custom",
          message: "an ID business does not carry addressState or addressPostcode",
          path: ["addressState"],
        });
      }
    }
  });

export type CreateBusinessRequest = z.infer<typeof createBusinessSchema>;

export class CreateBusinessDto extends createZodDto(createBusinessSchema) {}
