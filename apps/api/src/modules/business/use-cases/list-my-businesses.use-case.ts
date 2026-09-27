import type { Business } from "@yourtal/contracts/business";
import type { BusinessTeamRole } from "@yourtal/contracts/business/team-role";
import type { ResultAsync } from "neverthrow";
import type { PersistenceFailedError } from "../business.errors";
import type { BusinessAccountRepository } from "../persistence/business-account.repository";
import type { BusinessMemberRepository } from "../persistence/business-member.repository";
import { wrapPersistence } from "../wrap-persistence";

export interface MyBusinessMembership {
  readonly business: Business;
  readonly role: BusinessTeamRole;
  readonly joinedAt: string;
}

/**
 * `GET /api/me/businesses` (TASKS.md 7.1.b) — every business the caller has
 * actually joined (an outstanding invite is not a membership yet, and
 * `listByUser` already filters to joined rows). Resolving each business
 * account and dropping a membership whose account is somehow missing,
 * rather than throwing, is the same defensive read this codebase favours
 * over a 500 for a data state that should not happen but is not this
 * endpoint's job to repair.
 */
export function listMyBusinesses(
  businesses: BusinessAccountRepository,
  members: BusinessMemberRepository,
  userId: string,
): ResultAsync<readonly MyBusinessMembership[], PersistenceFailedError> {
  return wrapPersistence(members.listByUser(userId)).andThen((memberships) =>
    wrapPersistence(
      Promise.all(
        memberships.map(async (membership) => {
          if (membership.joinedAt === null) return null;
          const business = await businesses.findById(membership.businessId);
          if (business === null) return null;
          return { business, role: membership.role, joinedAt: membership.joinedAt };
        }),
      ),
    ).map((results) => results.filter((row): row is MyBusinessMembership => row !== null)),
  );
}
