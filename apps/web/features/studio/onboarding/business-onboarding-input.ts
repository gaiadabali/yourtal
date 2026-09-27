import { z } from "zod";
import { auStateSchema, businessHandleSchema, taxIdKindSchema } from "@yourtal/contracts/business";
import type { TaxIdKind } from "@yourtal/contracts/business";
import { regionSchema } from "@yourtal/contracts/region";

/**
 * Onboarding's own draft shape (task 7.8.b) — the raw form fields, matching
 * `@yourtal/contracts/business`'s real `taxIdKind`/`taxIdValue`/
 * `addressState`/`addressPostcode`/`addressCity` fields (7.1.a, merged to
 * main) rather than a locally-invented superset. There is no separate
 * street-address field in the real contract, only state+postcode (AU) or
 * city (ID) — this form does not collect one either.
 */

/** The tax-id kinds selectable for each region — ABN only for AU, a choice of NIB or NPWP for ID (TASKS.md 7.1.a). */
export const TAX_ID_KINDS_BY_REGION = {
  AU: ["ABN"],
  ID: ["NIB", "NPWP"],
} as const satisfies Record<string, readonly TaxIdKind[]>;

// Deliberately simple digit-count checks, not the official checksum
// algorithms (ABN's modulus-89 check, NPWP's own) — this mirrors
// `business.ts`'s own `TAX_ID_VALUE_PATTERN` (not exported, so restated
// here); this is a simulated onboarding flow (CLAUDE.md: "everything
// external is a simulated driver"), not a real government registry lookup.
const TAX_ID_VALUE_PATTERN: Record<TaxIdKind, RegExp> = {
  ABN: /^\d{11}$/,
  NIB: /^\d{13}$/,
  NPWP: /^\d{15,16}$/,
};

export function isValidTaxIdValue(kind: TaxIdKind, value: string): boolean {
  return TAX_ID_VALUE_PATTERN[kind].test(value.replace(/[.\s-]/g, ""));
}

const auPostcodeSchema = z.string().regex(/^\d{4}$/, "postcode must be 4 digits");

export const createBusinessInputSchema = z
  .object({
    legalName: z.string().min(1).max(160),
    displayName: z.string().min(1).max(120),
    handle: businessHandleSchema,
    region: regionSchema,
    taxIdKind: taxIdKindSchema,
    taxIdValue: z.string().min(1).max(32),
    /** AU only. */
    state: auStateSchema.optional(),
    /** AU only. */
    postcode: auPostcodeSchema.optional(),
    /** ID only. */
    city: z.string().min(1).max(120).optional(),
  })
  .refine(
    (input) =>
      (TAX_ID_KINDS_BY_REGION[input.region] as readonly TaxIdKind[]).includes(input.taxIdKind),
    {
      message: "tax id kind must match the business's region",
      path: ["taxIdKind"],
    },
  )
  .refine((input) => isValidTaxIdValue(input.taxIdKind, input.taxIdValue), {
    message: "tax id value is not a plausible number for this kind",
    path: ["taxIdValue"],
  })
  .refine(
    (input) =>
      input.region === "AU"
        ? input.state !== undefined && input.postcode !== undefined && input.city === undefined
        : input.city !== undefined && input.state === undefined && input.postcode === undefined,
    {
      message: "address must match the business's region (AU: state + postcode; ID: city)",
      path: ["state"],
    },
  );

export type CreateBusinessInput = z.infer<typeof createBusinessInputSchema>;
