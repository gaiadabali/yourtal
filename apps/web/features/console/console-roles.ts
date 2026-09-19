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
export const CONSOLE_ROLES = [
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
export const ASSIGNABLE_ROLES = CONSOLE_ROLES.filter(
  (role): role is Exclude<BusinessTeamRole, "owner"> => role !== "owner",
);

export const ROLE_LABELS: Record<BusinessTeamRole, string> = {
  owner: "Owner",
  admin: "Admin",
  marketer: "Marketer",
  merchandiser: "Merchandiser",
  finance: "Finance",
  analyst: "Analyst",
};

export const ROLE_DESCRIPTIONS: Record<BusinessTeamRole, string> = {
  owner: "Full control, including billing and deleting the business. Exactly one per business.",
  admin:
    "Runs campaigns, inventory, redemption, reports and the team. Cannot touch billing beyond viewing it.",
  marketer: "Creates and edits campaigns. Views reports.",
  merchandiser: "Creates and edits inventory listings. Views reports.",
  finance: "Manages billing and views reports. No access to campaigns, inventory or redemption.",
  analyst: "Read-only across campaigns, inventory and reports.",
};
