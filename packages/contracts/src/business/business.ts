import { z } from "zod";
import { currencySchema } from "../money/money-value";
import { REGION_CONFIG, regionSchema } from "../region/region";

/**
 * A business may hold any subset of three relationships — advertiser,
 * supplier, redeemer (docs/09 section 2, docs/17 section 2) — so `roles`
 * is a non-empty set rather than a single enum value.
 */
export const businessRoleSchema = z.enum(["advertiser", "supplier", "redeemer"]);
export type BusinessRole = z.infer<typeof businessRoleSchema>;

const MAX_LEGAL_NAME_LENGTH = 160;
const MAX_DISPLAY_NAME_LENGTH = 120;
const MAX_HANDLE_LENGTH = 40;

/**
 * A url-safe public handle (`yourtal.example/b/<handle>`, say) — lowercase,
 * digits and single internal hyphens, matching the same shape a listing or
 * campaign slug would need. Not derived from `displayName` here: a business
 * can rename without breaking every link that already points at its handle.
 */
export const businessHandleSchema = z
  .string()
  .min(3)
  .max(MAX_HANDLE_LENGTH)
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    "handle must be lowercase letters, digits and single hyphens only",
  );

/**
 * TASKS.md 7.1.a: the tax ID a business registers with, by region — ABN for
 * AU, NIB (Nomor Induk Berusaha) or NPWP (Nomor Pokok Wajib Pajak) for ID.
 * `district` (a free-text field with no region behind it) is gone; this and
 * `businessAddressSchema` below are what replace it (docs/audit/2026-09-25/
 * business-merchant.md's own recommendation, "Drop district as the address
 * model").
 */
export const taxIdKindSchema = z.enum(["ABN", "NIB", "NPWP"]);
export type TaxIdKind = z.infer<typeof taxIdKindSchema>;

/**
 * Digit-count only, not a checksum — an ABN's real check-digit algorithm
 * (and NPWP's) is a compliance detail for whoever actually integrates ABR/
 * DJP lookups (9.3's KYB review), not something this contract should assert
 * on the founder's behalf.
 */
const TAX_ID_VALUE_PATTERN: Record<TaxIdKind, RegExp> = {
  ABN: /^\d{11}$/,
  NIB: /^\d{13}$/,
  NPWP: /^\d{15,16}$/,
};

export const AU_STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"] as const;
export const auStateSchema = z.enum(AU_STATES);
export type AuState = z.infer<typeof auStateSchema>;

const auPostcodeSchema = z.string().regex(/^\d{4}$/, "postcode must be 4 digits");

export const businessSchema = z
  .object({
    id: z.uuid(),
    legalName: z.string().min(1).max(MAX_LEGAL_NAME_LENGTH),
    displayName: z.string().min(1).max(MAX_DISPLAY_NAME_LENGTH),
    taxIdKind: taxIdKindSchema,
    taxIdValue: z.string().min(1).max(32),
    /** AU only; `null` for an ID business. */
    addressState: auStateSchema.nullable(),
    /** AU only; `null` for an ID business. */
    addressPostcode: auPostcodeSchema.nullable(),
    /** ID only; `null` for an AU business. */
    addressCity: z.string().min(1).max(120).nullable(),
    roles: z.array(businessRoleSchema).min(1),
    isVerified: z.boolean(),
    logoUrl: z.url().nullable(),
    /**
     * Set once at onboarding and never changed after (TASKS.md 1.1.a).
     * Enforcement of the "never" half is at the application layer — nothing
     * here writes `region` again once a row exists — the same way
     * `campaignTermsSchema` enforces "frozen" by never being UPDATEd rather
     * than by a database trigger. F2: every campaign, listing, rate and job
     * this business touches inherits this region and none other.
     */
    region: regionSchema,
    /** Always this region's own currency (`REGION_CONFIG[region].currency`) — see the refine below. */
    currency: currencySchema,
    handle: businessHandleSchema,
    coverUrl: z.url().nullable(),
  })
  .refine((business) => new Set(business.roles).size === business.roles.length, {
    message: "roles must not contain duplicates",
    path: ["roles"],
  })
  .refine((business) => business.currency === REGION_CONFIG[business.region].currency, {
    message: "currency must match the business's own region (F2: regions never cross)",
    path: ["currency"],
  })
  .refine(
    (business) =>
      business.region === "AU"
        ? business.taxIdKind === "ABN"
        : business.taxIdKind === "NIB" || business.taxIdKind === "NPWP",
    {
      message: "taxIdKind must match the business's region (ABN for AU; NIB or NPWP for ID)",
      path: ["taxIdKind"],
    },
  )
  .refine((business) => TAX_ID_VALUE_PATTERN[business.taxIdKind].test(business.taxIdValue), {
    message: "taxIdValue does not match the expected shape for its taxIdKind",
    path: ["taxIdValue"],
  })
  .refine(
    (business) =>
      business.region === "AU"
        ? business.addressState !== null &&
          business.addressPostcode !== null &&
          business.addressCity === null
        : business.addressCity !== null &&
          business.addressState === null &&
          business.addressPostcode === null,
    {
      message: "address must match the business's region (AU: state + postcode; ID: city)",
      path: ["addressState"],
    },
  );

export type Business = z.infer<typeof businessSchema>;
