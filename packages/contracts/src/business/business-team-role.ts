import { z } from "zod";

/**
 * The role one person holds at one business. YT-0509.
 *
 * ## Why this lives in contracts and not in the authorization package
 *
 * A business member **carries this role in an API payload** — it is on the
 * team roster, in an invitation, in a role-change request. That makes the
 * role vocabulary a contract concern by definition. Cerbos policy is an
 * *implementation* of authorization over this vocabulary, not its source, and
 * `docs/10` calls this package the spine: a spine should not import from an
 * implementation detail of one of its own consumers.
 *
 * It lived in `@yourtal/authz` first, which put an edge from contracts to
 * authz. `@yourtal/authz/roles` now imports it from here instead, and keeps
 * its drift test asserting these values match `policies/_schemas/principal.json`.
 * So the coupling to Cerbos stays exactly where it already was — in authz —
 * and this package never learns Cerbos exists.
 *
 * ## Not to be confused with `businessRoleSchema` in `business.ts`
 *
 * That one is advertiser / supplier / redeemer: the **relationships a
 * business holds with the platform**, of which it may hold any subset
 * (`docs/17` §2). This one is the **person's job inside that business**. Two
 * genuinely different things that both wanted the name "business role", which
 * is why this one is explicitly `businessTeamRole`.
 *
 * ## The six roles are `docs/17` §2.1, transcribed
 *
 *   Owner         edit campaigns, edit inventory, redeem, reports, edit
 *                 billing, edit team, delete the account
 *   Admin         as Owner, except billing is view-only and cannot delete
 *   Marketer      campaigns and reports
 *   Merchandiser  inventory and reports
 *   Finance       billing and reports
 *   Analyst       read-only across campaigns, inventory and reports
 *
 * Store staff are deliberately absent. They are device sessions bound to a
 * location, not members (`docs/17` §2.2) — see `store_device` in
 * `@yourtal/authz/roles`, which is an authorization concept and stays there.
 *
 * **Exactly one Owner per business**, transferable only by the current Owner
 * with a fresh step-up re-authentication. That invariant is enforced in the
 * policy repo (`policies/resource_policies/team.yaml`), not here — a Zod enum
 * cannot express "exactly one of these exists across all members".
 */
export const businessTeamRoleSchema = z.enum([
  "owner",
  "admin",
  "marketer",
  "merchandiser",
  "finance",
  "analyst",
]);

export type BusinessTeamRole = z.infer<typeof businessTeamRoleSchema>;
