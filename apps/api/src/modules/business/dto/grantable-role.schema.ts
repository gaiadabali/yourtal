import { businessRoleSchema } from "@yourtal/authz/roles";

/**
 * `owner` is reachable only through `transfer_ownership` (docs/17 section
 * 2.1); invite and change-role must never be able to name it. Enforced here,
 * at the request boundary, in addition to the `team.yaml` Cerbos rule that
 * denies `change_role`/`remove_member` targeting it — see
 * `business.errors.ts` for why the use-case layer does not repeat this a
 * third time.
 */
export const grantableRoleSchema = businessRoleSchema.exclude(["owner"]);
export type GrantableRole = (typeof grantableRoleSchema)["options"][number];
