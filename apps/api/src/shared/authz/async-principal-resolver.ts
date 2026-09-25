import { Inject, Injectable } from "@nestjs/common";
import { principalSchema } from "@yourtal/authz/principal";
import type { Principal } from "@yourtal/authz/principal";
import { businessRoleSchema } from "@yourtal/authz/roles";
import type { PrincipalRole } from "@yourtal/authz/roles";
import { ageBandFrom, ageYearsFrom } from "@yourtal/jurisdiction/age";
import type { FastifyRequest } from "fastify";
import { PrincipalService } from "./principal.service";
import { PRINCIPAL_SECURITY_STATE_REPOSITORY } from "../../modules/identity/persistence/principal-security-state.repository";
import type { PrincipalSecurityStateRepository } from "../../modules/identity/persistence/principal-security-state.repository";
import { USER_PROFILE_REPOSITORY } from "../../modules/identity/persistence/user-profile.repository";
import type { UserProfileRepository } from "../../modules/identity/persistence/user-profile.repository";
import { BUSINESS_MEMBERSHIP_READER } from "../../modules/identity/persistence/business-membership-reader";
import type { BusinessMembershipReader } from "../../modules/identity/persistence/business-membership-reader";
import { STAFF_ROLE_READER } from "../../modules/identity/persistence/staff-role-reader";
import type { StaffRoleReader } from "../../modules/identity/persistence/staff-role-reader";

/**
 * The async, DB-reading counterpart to `PrincipalService.resolve()`
 * (YT-0582). `resolve()` is synchronous and reads only the request, which
 * is exactly why `valueFrozenUntil` — the 72h SIM-swap / account-recovery
 * freeze `policies/derived_roles/common.yaml` gates spend on (docs/14
 * section 5) — was never populatable by anything in this codebase. As of
 * 1.5.b, the same reasoning covers five more facts a header must never be
 * trusted for: `jurisdiction` (F2's region wall), `ageBand`, `isSuspended`
 * and `businessRoles` all come from `identity.user_profile` /
 * `business.business_members` when a profile row exists, and staff roles
 * come from `identity.staff_role` regardless. `reauthenticatedAt`,
 * `hasPasskey` and `goodwillCreditCeilingIdr` remain unpopulated on
 * purpose: `reauthenticatedAt`/`hasPasskey` are step-up-auth state pending
 * the auth work in YT-0540/0541, and `goodwillCreditCeilingIdr` is
 * economy-owned (YT-0050).
 *
 * ## Falls back to the header when there is no profile row
 *
 * A principal with no `identity.user_profile` row (a synthetic test id, or
 * a principal 1.4's registration never created — there is no other way to
 * get one today) keeps `PrincipalService`'s header-derived `jurisdiction`,
 * `isSuspended` and `businessRoles` exactly as before. This is not a
 * loophole for a real account: every real consumer has a profile row from
 * the moment they register (1.4.c), so this path exists only for principals
 * this codebase itself invents (tests, fixtures) — the same reasoning
 * `valueFrozenUntil` already applies for `PrincipalSecurityStateRepository`.
 * Staff roles are the one exception: they are folded in whether or not a
 * profile row exists, since `pnpm staff:add` can grant a role to any user id
 * regardless of whether that id ever completed consumer registration.
 *
 * ## A separate class, not a new method on `PrincipalService`
 *
 * `apps/api/src/modules/store/**` and `apps/api/src/modules/watch/**` duck-
 * type `PrincipalService` directly in their own tests — a plain
 * `{ resolve: vi.fn() }` passed wherever a `PrincipalService` is expected,
 * with no cast. Any new public member added to that class breaks structural
 * assignability for every one of those fakes. Composing `PrincipalService`
 * from outside keeps its own type exactly as it was.
 */
@Injectable()
export class AsyncPrincipalResolver {
  constructor(
    private readonly principals: PrincipalService,
    @Inject(PRINCIPAL_SECURITY_STATE_REPOSITORY)
    private readonly securityState: PrincipalSecurityStateRepository,
    @Inject(USER_PROFILE_REPOSITORY)
    private readonly profiles: UserProfileRepository,
    @Inject(BUSINESS_MEMBERSHIP_READER)
    private readonly memberships: BusinessMembershipReader,
    @Inject(STAFF_ROLE_READER)
    private readonly staffRoleReader: StaffRoleReader,
  ) {}

  async resolve(request: FastifyRequest): Promise<Principal> {
    const base = this.principals.resolve(request);
    if (base.id === "anonymous") {
      return base;
    }

    const [security, profile, staffRoles] = await Promise.all([
      this.securityState.findByUserId(base.id),
      this.profiles.findByUserId(base.id),
      this.staffRoleReader.listForUser(base.id),
    ]);

    let attr = base.attr;
    if (security?.valueFrozenUntil != null) {
      attr = { ...attr, valueFrozenUntil: security.valueFrozenUntil.toISOString() };
    }

    let roles: readonly PrincipalRole[] = base.roles;

    if (profile !== null) {
      const memberships = await this.memberships.listForUser(base.id);
      // Parsed, not cast: `BusinessMembershipReader`'s own role column is
      // plain `string` at that boundary, so this is the point that turns it
      // into the closed enum `principalAttrSchema` requires.
      const businessRoles = Object.fromEntries(
        memberships.map((membership) => [membership.businessId, businessRoleSchema.parse(membership.role)]),
      );

      attr = {
        ...attr,
        jurisdiction: profile.region,
        ageBand: ageBandFrom(ageYearsFrom(profile.dateOfBirth, new Date())),
        isSuspended: profile.suspendedAt !== null,
        businessRoles,
      };

      roles = withoutRole(base.roles, "business_user");
      if (Object.keys(businessRoles).length > 0) {
        roles = [...roles, "business_user"];
      }
    }

    if (staffRoles.length > 0) {
      roles = dedupeRoles([...roles, ...staffRoles]);
    }

    if (attr === base.attr && roles === base.roles) {
      return base;
    }

    return principalSchema.parse({ ...base, roles, attr });
  }
}

function withoutRole(
  roles: readonly PrincipalRole[],
  excluded: PrincipalRole,
): readonly PrincipalRole[] {
  return roles.filter((role) => role !== excluded);
}

function dedupeRoles(roles: readonly PrincipalRole[]): readonly PrincipalRole[] {
  return [...new Set(roles)];
}
