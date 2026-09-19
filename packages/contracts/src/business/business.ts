import { z } from "zod";

/**
 * A business may hold any subset of three relationships — advertiser,
 * supplier, redeemer (docs/09 section 2, docs/17 section 2) — so `roles`
 * is a non-empty set rather than a single enum value.
 */
export const businessRoleSchema = z.enum(["advertiser", "supplier", "redeemer"]);
export type BusinessRole = z.infer<typeof businessRoleSchema>;

const MAX_LEGAL_NAME_LENGTH = 160;
const MAX_DISPLAY_NAME_LENGTH = 120;

export const businessSchema = z
  .object({
    id: z.uuid(),
    legalName: z.string().min(1).max(MAX_LEGAL_NAME_LENGTH),
    displayName: z.string().min(1).max(MAX_DISPLAY_NAME_LENGTH),
    district: z.string().min(1).max(60),
    roles: z.array(businessRoleSchema).min(1),
    isVerified: z.boolean(),
    logoUrl: z.url().nullable(),
  })
  .refine((business) => new Set(business.roles).size === business.roles.length, {
    message: "roles must not contain duplicates",
    path: ["roles"],
  });

export type Business = z.infer<typeof businessSchema>;
