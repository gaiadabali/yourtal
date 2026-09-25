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

export const businessSchema = z
  .object({
    id: z.uuid(),
    legalName: z.string().min(1).max(MAX_LEGAL_NAME_LENGTH),
    displayName: z.string().min(1).max(MAX_DISPLAY_NAME_LENGTH),
    district: z.string().min(1).max(60),
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
  });

export type Business = z.infer<typeof businessSchema>;
