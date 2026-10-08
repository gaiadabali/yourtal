import type { BusinessTeamRole } from "@yourtal/contracts/business/team-role";

/**
 * The six team-membership roles (docs/17-surfaces-and-roles.md §2.1,
 * `policies/derived_roles/business.yaml`) — a person's role AT one
 * business, never a business's own advertiser/supplier/redeemer
 * relationships (`@yourtal/contracts/business`'s `businessRoleSchema`, a
 * different, unrelated vocabulary — see `business-team-role.ts`'s own
 * doc comment for why the two are named differently on purpose).
 *
 * This file only ever `import type`s `BusinessTeamRole` from
 * `@yourtal/contracts/business/team-role` — never the package's
 * `businessTeamRoleSchema` value, which is a Zod schema. A value import
 * here would drag Zod's ~96 KB gz into every client component that renders
 * a role label or a role picker (docs/13b-typescript-standards.md §8's
 * 200 KB gate). The literal array below is checked against the real type
 * with `satisfies`, so it cannot silently drift from
 * `packages/contracts/src/business/business-team-role.ts`.
 */
export const STUDIO_ROLES = [
  "owner",
  "admin",
  "marketer",
  "merchandiser",
  "finance",
  "analyst",
] as const satisfies readonly BusinessTeamRole[];

/**
 * Roles assignable through `invite` or `change_role`. `owner` is
 * deliberately excluded — `policies/resource_policies/team.yaml`'s
 * `ownership-moves-only-by-transfer` rule denies `change_role` outright the
 * moment `targetRole == "owner"`, and invitation cannot create a second
 * owner either (docs/17 §2.1: "exactly one Owner"). `transfer_ownership`
 * is the only door, modelled separately in `team-actions.ts`.
 */
export const ASSIGNABLE_ROLES = STUDIO_ROLES.filter(
  (role): role is Exclude<BusinessTeamRole, "owner"> => role !== "owner",
);

/** A role's display name, from the `studio` catalogue's `roles.label.*` keys. */
export function roleLabel(t: (key: string) => string, role: BusinessTeamRole): string {
  return t(`roles.label.${role}`);
}

/** One line on what a role may do, from `roles.description.*`. */
export function roleDescription(t: (key: string) => string, role: BusinessTeamRole): string {
  return t(`roles.description.${role}`);
}
