import { z } from "zod";
import { businessRoleSchema, principalRoleSchema } from "./roles";

/**
 * The principal as the PDP sees it.
 *
 * This schema mirrors `policies/_schemas/principal.json`, which Cerbos
 * enforces on its side with `additionalProperties: false`. Both are strict
 * on purpose: an attribute the policy repo does not know about is a typo or
 * a half-finished feature, and either one should fail loudly here rather
 * than quietly produce a DENY at the PDP that looks like a policy bug.
 *
 * Nothing in here is taken from the request body. Every field is derived
 * server-side from the session, the identity provider or the risk service —
 * a principal assembled from anything a caller sent would make the whole
 * decision point decorative.
 */

/** Matches the RFC3339 timestamps Cerbos parses with `timestamp()`. */
const rfc3339Schema = z.iso.datetime({ offset: true });

export const principalAttrSchema = z
  .object({
    /** Governing jurisdiction. Feature switches live in YT-0037, not here. */
    jurisdiction: z.enum(["ID", "AU"]),

    /**
     * businessId -> the role held at THAT business. The whole multi-tenancy
     * model. A person can be owner of one business and analyst of another,
     * and this is the only structure that says so.
     */
    businessRoles: z.record(z.string().min(1), businessRoleSchema),

    /** Risk has suspended this principal. Value actions are denied. */
    isSuspended: z.boolean(),

    isPhoneVerified: z.boolean().optional(),

    /**
     * docs/14 section 5 — a passkey is required before the first redemption
     * above the value threshold.
     */
    hasPasskey: z.boolean().optional(),

    /**
     * Step-up re-auth time. Ownership transfer requires this to be minutes
     * old; see `ownership-transfer-needs-fresh-reauth` in policies/team.yaml.
     */
    reauthenticatedAt: rfc3339Schema.optional(),

    /**
     * The 72h freeze a SIM swap or an account recovery starts (docs/14
     * section 5). Blocks redemption and transfer, never reading.
     */
    valueFrozenUntil: rfc3339Schema.optional(),

    /**
     * store_device only: the business the device was provisioned for. Set at
     * provisioning time and never read from the request, so a stolen device
     * cannot redeem for a different merchant.
     */
    deviceBusinessId: z.string().min(1).optional(),

    /** store_device only: the location it was bound to. */
    deviceLocationId: z.string().min(1).optional(),

    /** support only: the ceiling below which goodwill needs no approver. */
    goodwillCreditCeilingIdr: z.number().int().nonnegative().optional(),

    /**
     * 1.5.b, from `identity.user_profile.date_of_birth` (computed at read
     * time, `@yourtal/jurisdiction/age`'s `ageBandFrom`, never stored twice).
     * Absent for `anonymous` and `store_device`, neither of which has a
     * profile.
     */
    ageBand: z.enum(["teen", "adult"]).optional(),
  })
  .strict();

export type PrincipalAttr = z.infer<typeof principalAttrSchema>;

export const principalSchema = z
  .object({
    id: z.string().min(1),
    roles: z.array(principalRoleSchema).min(1),
    attr: principalAttrSchema,
  })
  .strict();

export type Principal = z.infer<typeof principalSchema>;

/**
 * The principal for a signed-out visitor. Constructed here, once, so that
 * no surface invents its own idea of what anonymous means — docs/17 section
 * 4.6 lists precisely what such a visitor cannot do, and every one of those
 * is a DENY in the policy repo rather than an omission here.
 */
export function anonymousPrincipal(jurisdiction: PrincipalAttr["jurisdiction"]): Principal {
  return {
    id: "anonymous",
    roles: ["anonymous"],
    attr: { jurisdiction, businessRoles: {}, isSuspended: false },
  };
}
