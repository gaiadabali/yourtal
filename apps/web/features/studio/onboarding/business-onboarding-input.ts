import { z } from "zod";
import { businessHandleSchema } from "@yourtal/contracts/business";
import { regionSchema } from "@yourtal/contracts/region";

/**
 * Onboarding's own draft shape (task 7.1.a/7.8.b) — a superset of today's
 * `businessSchema`: it also carries the tax-id and address fields 7.1.a's
 * migration adds to the real contract, which this screen is built against
 * ahead of that migration landing (`studio-data.ts`'s `createBusiness` mock
 * ignores the fields the current `Business` type has nowhere to put yet).
 * Once 7.1 merges a real `taxIdKind`/`taxIdValue`/address shape on
 * `Business`, this file's schema is the one that should be deleted in
 * favour of importing the contract's own.
 */
export const auTaxIdKindSchema = z.literal("ABN");
export const idTaxIdKindSchema = z.enum(["NIB", "NPWP"]);
export const taxIdKindSchema = z.union([auTaxIdKindSchema, idTaxIdKindSchema]);
export type TaxIdKind = z.infer<typeof taxIdKindSchema>;

/** The tax-id kinds selectable for each region — ABN only for AU, a choice of NIB or NPWP for ID (TASKS.md 7.1.a). */
export const TAX_ID_KINDS_BY_REGION = {
  AU: ["ABN"],
  ID: ["NIB", "NPWP"],
} as const satisfies Record<string, readonly TaxIdKind[]>;

// Deliberately simple digit-count checks, not the official checksum
// algorithms (ABN's modulus-89 check, NPWP's own) — this is a simulated
// onboarding flow (CLAUDE.md: "everything external is a simulated driver"),
// not a real government registry lookup.
const TAX_ID_VALUE_PATTERN: Record<TaxIdKind, RegExp> = {
  ABN: /^\d{11}$/,
  NIB: /^\d{13}$/,
  NPWP: /^\d{15,16}$/,
};

export function isValidTaxIdValue(kind: TaxIdKind, value: string): boolean {
  return TAX_ID_VALUE_PATTERN[kind].test(value.replace(/[.\s-]/g, ""));
}

export const createBusinessInputSchema = z
  .object({
    legalName: z.string().min(1).max(160),
    displayName: z.string().min(1).max(120),
    handle: businessHandleSchema,
    region: regionSchema,
    taxIdKind: taxIdKindSchema,
    taxIdValue: z.string().min(1),
    addressLine: z.string().min(1).max(200),
    city: z.string().min(1).max(60),
    /** AU only: state/territory abbreviation. Required for AU, absent for ID (ID uses `city` alone). */
    state: z.string().min(1).max(10).optional(),
    postcode: z.string().min(1).max(12),
  })
  .refine((input) => TAX_ID_KINDS_BY_REGION[input.region].includes(input.taxIdKind), {
    message: "tax id kind must match the business's region",
    path: ["taxIdKind"],
  })
  .refine((input) => isValidTaxIdValue(input.taxIdKind, input.taxIdValue), {
    message: "tax id value is not a plausible number for this kind",
    path: ["taxIdValue"],
  })
  .refine((input) => input.region !== "AU" || !!input.state, {
    message: "state is required for an AU business",
    path: ["state"],
  });

export type CreateBusinessInput = z.infer<typeof createBusinessInputSchema>;
