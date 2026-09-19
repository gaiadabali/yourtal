import { z } from "zod";
import { businessTeamRoleSchema } from "@yourtal/contracts/business/team-role";
import type { BusinessTeamRole } from "@yourtal/contracts/business/team-role";

/**
 * The role taxonomy, and the single place it is written down in TypeScript.
 *
 * These strings are load-bearing: they must match the `roles` and
 * `businessRoles` values in `policies/` exactly, or a principal will be
 * built that no policy rule can ever match — which surfaces as a DENY that
 * looks like a policy bug and is actually a typo. `policy-drift.test.ts`
 * reads the YAML and fails the build if the two ever disagree, so this file
 * and the policy repo cannot drift apart silently.
 *
 * Source: docs/17-surfaces-and-roles.md sections 2.1, 2.2 and 5, which
 * supersedes the coarser list in docs/02 section 3 (`user, business admin,
 * business member, charity admin, merchant staff, internal`).
 */

/**
 * Flat roles, as they arrive from the identity provider (Zitadel, YT-0032).
 *
 * Note what is NOT here: there is no `business_admin`. A flat role cannot
 * answer "admin of WHICH business", so every business person carries the
 * single role `business_user` and the role they hold AT A GIVEN BUSINESS is
 * looked up per-request from `businessRoles`. See `businessRoleSchema`.
 */
export const principalRoleSchema = z.enum([
  /** A signed-out visitor. Open Viewing only — docs/17 section 4. */
  "anonymous",
  /** A signed-in consumer. */
  "user",
  /** Anyone who holds a role at at least one business. */
  "business_user",
  /**
   * A provisioned counter device, NOT a person (docs/17 section 2.2). A PIN
   * unlocks the session; it does not authenticate an individual, so staff
   * turnover never means account churn.
   */
  "store_device",
  /** Phase 3 placeholder — charity is out of scope until then (docs/04). */
  "charity_admin",
  // --- internal, docs/17 section 5 ---
  "support",
  "moderator",
  "risk_analyst",
  "finance",
  "ops",
  /** Role grants, feature flags, kill switches — and no direct data access. */
  "admin",
]);

export type PrincipalRole = z.infer<typeof principalRoleSchema>;

/**
 * The role a principal holds at one particular business — docs/17 section
 * 2.1. Store staff are deliberately absent: they are device sessions, not
 * members, and appear as the `store_device` principal role instead.
 *
 * **Defined in `@yourtal/contracts`, not here (YT-0509).** A business member
 * carries this role in an API payload, which makes the vocabulary a contract
 * concern; Cerbos policy is an implementation of authorization *over* that
 * vocabulary, not its source. What stays here is the coupling that belongs
 * here: `policy-drift.test.ts` asserts these values match
 * `policies/_schemas/principal.json`, so contracts never learns Cerbos exists
 * and the drift guarantee is unaffected.
 *
 * Re-exported under the local names because `apps/web`, `apps/api` and this
 * package's own `principal.ts` all import them from here. An alias is a mild
 * smell; renaming across three packages mid-flight, two of which another
 * session is actively editing, is a worse one.
 */
export const businessRoleSchema = businessTeamRoleSchema;

export type BusinessRole = BusinessTeamRole;

/**
 * Internal roles, as a set, for the one question services actually ask of
 * this list: "is this principal staff?". Derived from `principalRoleSchema`
 * rather than retyped, so a new internal role cannot be added in one place
 * and forgotten in the other.
 */
export const INTERNAL_ROLES = [
  "support",
  "moderator",
  "risk_analyst",
  "finance",
  "ops",
  "admin",
] as const satisfies readonly PrincipalRole[];

export function isInternalRole(role: PrincipalRole): boolean {
  return (INTERNAL_ROLES as readonly PrincipalRole[]).includes(role);
}
