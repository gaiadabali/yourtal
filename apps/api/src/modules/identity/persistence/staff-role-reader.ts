import type { PrincipalRole } from "@yourtal/authz/roles";

/**
 * 1.5.b: `identity.staff_role`, written only by `pnpm staff:add` against the
 * owner connection (docs/14 section 8 — a role grant is not a thing the
 * running application ever does to itself). `AsyncPrincipalResolver` is the
 * only reader, folding the result into `Principal.roles` alongside the
 * flat `user`/`business_user` roles `PrincipalService` already assembles.
 */
export interface StaffRoleReader {
  /** Every internal role this user holds. Empty for a principal with none — most of them. */
  listForUser(userId: string): Promise<readonly PrincipalRole[]>;
}

export const STAFF_ROLE_READER = Symbol("STAFF_ROLE_READER");
