import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
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
 * ## No profile row, no principal (2.5/F31)
 *
 * A SIGNED-IN principal (`base.id !== "anonymous"` — a real, validated
 * session or bearer token) with no `identity.user_profile` row is REFUSED
 * outright, not handed the header-derived placeholder jurisdiction/
 * ageBand/isSuspended/businessRoles `PrincipalService` sets. Before 2.5 this
 * fell through to those placeholders, which is exactly the F31 gap: a
 * registration whose profile write failed after its credential committed
 * left an account that could still sign in as an ID principal with no age
 * band, because nothing here ever refused it. As of 2.5, `AuthService
 * .register` writes the credential and the profile in ONE transaction (see
 * its own comment), so a real account can no longer exist without a
 * profile — the only way `resolve()` reaches this branch now is a
 * principal this codebase itself invents (a test's fake `SessionValidator`
 * naming a user id nobody registered), never a real session. Refusing here
 * rather than keeping a "test-only" carve-out means a test that fabricates
 * a signed-in principal has to seed a profile for it (`seedUserProfile`),
 * exactly as a real one always has one.
 *
 * Staff roles no longer need their own "folds in regardless of a profile"
 * carve-out either: `pnpm staff:add` grants a role to an EXISTING account,
 * looked up by its already-registered credential (see that script's own
 * comment), so a legitimate staff account always has a profile too, from
 * the same registration transaction as everyone else.
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
    const base = await this.principals.resolve(request);
    if (base.id === "anonymous") {
      return base;
    }

    // 2.5/F31: checked before anything else, and before the three other
    // lookups below even run — a signed-in principal with no profile row is
    // refused outright now, never handed the header-derived placeholder. See
    // this class's own doc comment for why reaching here can no longer
    // happen for a real account.
    const profile = await this.profiles.findByUserId(base.id);
    if (profile === null) {
      throw noProfileException();
    }

    const [security, staffRoles, memberships] = await Promise.all([
      this.securityState.findByUserId(base.id),
      this.staffRoleReader.listForUser(base.id),
      this.memberships.listForUser(base.id),
    ]);

    let attr = base.attr;
    if (security?.valueFrozenUntil != null) {
      attr = { ...attr, valueFrozenUntil: security.valueFrozenUntil.toISOString() };
    }

    // Parsed, not cast: `BusinessMembershipReader`'s own role column is
    // plain `string` at that boundary, so this is the point that turns it
    // into the closed enum `principalAttrSchema` requires.
    const businessRoles = Object.fromEntries(
      memberships.map((membership) => [
        membership.businessId,
        businessRoleSchema.parse(membership.role),
      ]),
    );

    attr = {
      ...attr,
      jurisdiction: profile.region,
      ageBand: ageBandFrom(ageYearsFrom(profile.dateOfBirth, new Date())),
      isSuspended: profile.suspendedAt !== null,
      businessRoles,
    };

    let roles: readonly PrincipalRole[] = withoutRole(base.roles, "business_user");
    if (Object.keys(businessRoles).length > 0) {
      roles = [...roles, "business_user"];
    }
    if (staffRoles.length > 0) {
      roles = dedupeRoles([...roles, ...staffRoles]);
    }

    return principalSchema.parse({ ...base, roles, attr });
  }
}

/**
 * Same 401 shape `principal.service.ts`'s own `invalidSession()` uses for
 * `session_invalid` — a DIFFERENT code, because the session token itself
 * validated fine; it is the account behind it that has no
 * `identity.user_profile` row, which `AuthService.register` (2.5/F31) makes
 * impossible for anything registered from here on.
 */
function noProfileException(): UnauthorizedException {
  return new UnauthorizedException({
    code: "no_profile",
    message: "sign in again to continue",
  });
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
