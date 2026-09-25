import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { FastifyRequest } from "fastify";
import { AsyncPrincipalResolver } from "./async-principal-resolver";
import { PrincipalService } from "./principal.service";
import { alwaysValidSessionValidator } from "../testing/fake-session-validator";
import type {
  PrincipalSecurityState,
  PrincipalSecurityStateRepository,
} from "../../modules/identity/persistence/principal-security-state.repository";
import type {
  StoredUserProfile,
  UserProfileRepository,
} from "../../modules/identity/persistence/user-profile.repository";
import type {
  BusinessMembershipReader,
  BusinessMembershipSummary,
} from "../../modules/identity/persistence/business-membership-reader";
import type { StaffRoleReader } from "../../modules/identity/persistence/staff-role-reader";
import type { PrincipalRole } from "@yourtal/authz/roles";
import type { SessionValidator } from "./session-validator";

/** `alwaysValidSessionValidator` treats the cookie's token as the user id directly. */
function requestForUser(userId: string | undefined): FastifyRequest {
  return {
    headers: userId === undefined ? {} : { cookie: `yt_session=${userId}` },
  } as unknown as FastifyRequest;
}

/** A fake `identity.principal_security_state` — no rows unless seeded. */
function fakeSecurityStateRepo(
  rows: Record<string, PrincipalSecurityState> = {},
): PrincipalSecurityStateRepository {
  return {
    findByUserId: (userId) => Promise.resolve(rows[userId] ?? null),
  };
}

/** A fake `identity.user_profile` — no rows unless seeded (1.5.b). */
function fakeProfileRepo(rows: Record<string, StoredUserProfile> = {}): UserProfileRepository {
  return {
    create: () => Promise.reject(new Error("not used by this fake")),
    findByUserId: (userId) => Promise.resolve(rows[userId] ?? null),
    update: () => Promise.reject(new Error("not used by this fake")),
  };
}

/** A fake `business.business_members` reader (1.5.b) — empty unless seeded. */
function fakeMembershipReader(
  rows: Record<string, readonly BusinessMembershipSummary[]> = {},
): BusinessMembershipReader {
  return {
    listForUser: (userId) => Promise.resolve(rows[userId] ?? []),
  };
}

/** A fake `identity.staff_role` reader (1.5.b) — empty unless seeded. */
function fakeStaffRoleReader(rows: Record<string, readonly PrincipalRole[]> = {}): StaffRoleReader {
  return {
    listForUser: (userId) => Promise.resolve(rows[userId] ?? []),
  };
}

function profileFor(overrides: Partial<StoredUserProfile> = {}): StoredUserProfile {
  return {
    userId: "wina",
    region: "AU",
    displayLocale: "en-AU",
    displayName: "Wina",
    dateOfBirth: "1990-01-01",
    timezone: "Australia/Sydney",
    guardianEmail: null,
    parentConsentStatus: "not_required",
    trustTier: 0,
    suspendedAt: null,
    ...overrides,
  };
}

interface ResolverFixtures {
  readonly sessions?: SessionValidator;
  readonly security?: Record<string, PrincipalSecurityState>;
  readonly profiles?: Record<string, StoredUserProfile>;
  readonly memberships?: Record<string, readonly BusinessMembershipSummary[]>;
  readonly staffRoles?: Record<string, readonly PrincipalRole[]>;
}

function resolverWith(fixtures: ResolverFixtures = {}): AsyncPrincipalResolver {
  return new AsyncPrincipalResolver(
    new PrincipalService(fixtures.sessions ?? alwaysValidSessionValidator()),
    fakeSecurityStateRepo(fixtures.security),
    fakeProfileRepo(fixtures.profiles),
    fakeMembershipReader(fixtures.memberships),
    fakeStaffRoleReader(fixtures.staffRoles),
  );
}

describe("AsyncPrincipalResolver — YT-0582 (valueFrozenUntil)", () => {
  // The bug this whole ticket is about: a real principal, shaped exactly as
  // PrincipalService.resolve() produces it, must come back frozen when
  // stored state says so, and unfrozen when it does not — proved at this
  // seam directly, not only through a hand-built policy-test fixture.
  it("carries no valueFrozenUntil when the user has no security-state row", async () => {
    const resolver = resolverWith();
    const principal = await resolver.resolve(requestForUser("wina"));
    expect(principal.attr.valueFrozenUntil).toBeUndefined();
  });

  it("carries no valueFrozenUntil when the row exists but is null", async () => {
    const resolver = resolverWith({ security: { wina: { valueFrozenUntil: null } } });
    const principal = await resolver.resolve(requestForUser("wina"));
    expect(principal.attr.valueFrozenUntil).toBeUndefined();
  });

  it("carries valueFrozenUntil as an RFC3339 string when stored state has one", async () => {
    const frozenUntil = new Date("2026-09-24T10:00:00.000Z");
    const resolver = resolverWith({ security: { wina: { valueFrozenUntil: frozenUntil } } });
    const principal = await resolver.resolve(requestForUser("wina"));
    expect(principal.attr.valueFrozenUntil).toBe("2026-09-24T10:00:00.000Z");
  });

  it("never looks up anything for an anonymous principal", async () => {
    let called = false;
    const security: PrincipalSecurityStateRepository = {
      findByUserId: () => {
        called = true;
        return Promise.resolve(null);
      },
    };
    const resolver = new AsyncPrincipalResolver(
      new PrincipalService(alwaysValidSessionValidator()),
      security,
      fakeProfileRepo(),
      fakeMembershipReader(),
      fakeStaffRoleReader(),
    );
    const principal = await resolver.resolve(requestForUser(undefined));
    expect(principal.id).toBe("anonymous");
    expect(called).toBe(false);
  });

  it("still rejects an unknown/invalid session before ever reaching the database", async () => {
    const resolver = resolverWith({
      sessions: { validateAndTouch: () => Promise.resolve({ valid: false, reason: "not_found" }) },
    });
    await expect(resolver.resolve(requestForUser("owner-1"))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe("AsyncPrincipalResolver — 1.5.b (region, ageBand, suspension, business roles)", () => {
  it("with no profile row, uses safe placeholder defaults — no x-yt-* header can override them any more (1.5.a)", async () => {
    const resolver = resolverWith();
    const principal = await resolver.resolve(requestForUser("wina"));
    expect(principal.attr.jurisdiction).toBe("ID");
    expect(principal.attr.isSuspended).toBe(false);
    expect(principal.attr.businessRoles).toStrictEqual({});
    expect(principal.attr.ageBand).toBeUndefined();
  });

  it("with a profile row, region/ageBand/isSuspended/businessRoles come from the database", async () => {
    const resolver = resolverWith({
      profiles: {
        wina: profileFor({ region: "AU", dateOfBirth: "1990-01-01", suspendedAt: null }),
      },
      memberships: { wina: [{ businessId: "biz-real", role: "analyst" }] },
    });
    const principal = await resolver.resolve(requestForUser("wina"));
    expect(principal.attr.jurisdiction).toBe("AU");
    expect(principal.attr.isSuspended).toBe(false);
    expect(principal.attr.businessRoles).toStrictEqual({ "biz-real": "analyst" });
    expect(principal.attr.ageBand).toBe("adult");
    expect(principal.roles).toContain("business_user");
  });

  it("isSuspended is true when identity.user_profile.suspended_at is set", async () => {
    const resolver = resolverWith({
      profiles: { wina: profileFor({ suspendedAt: new Date("2026-01-01T00:00:00.000Z") }) },
    });
    const principal = await resolver.resolve(requestForUser("wina"));
    expect(principal.attr.isSuspended).toBe(true);
  });

  it("ageBand is teen for a 15-year-old and adult for a 40-year-old", async () => {
    const teen = resolverWith({ profiles: { wina: profileFor({ dateOfBirth: "2010-06-01" }) } });
    const adult = resolverWith({ profiles: { wina: profileFor({ dateOfBirth: "1986-06-01" }) } });
    const teenPrincipal = await teen.resolve(requestForUser("wina"));
    const adultPrincipal = await adult.resolve(requestForUser("wina"));
    // ageBandFrom computes from `new Date()` internally; this asserts the
    // shape rather than the exact band, since a fixed "now" is not injected
    // — the two dates of birth are chosen far enough apart (16 years either
    // side of 18) that today's date can never put both on the same side.
    expect(teenPrincipal.attr.ageBand).toBe("teen");
    expect(adultPrincipal.attr.ageBand).toBe("adult");
  });

  it("drops business_user when the profile shows no memberships at all", async () => {
    const resolver = resolverWith({ profiles: { wina: profileFor() }, memberships: { wina: [] } });
    const principal = await resolver.resolve(requestForUser("wina"));
    expect(principal.roles).not.toContain("business_user");
    expect(principal.attr.businessRoles).toStrictEqual({});
  });

  it("folds identity.staff_role into roles, with or without a profile", async () => {
    const withProfile = resolverWith({
      profiles: { wina: profileFor() },
      staffRoles: { wina: ["moderator"] },
    });
    const withoutProfile = resolverWith({ staffRoles: { staffer: ["finance", "ops"] } });

    const p1 = await withProfile.resolve(requestForUser("wina"));
    expect(p1.roles).toContain("moderator");

    const p2 = await withoutProfile.resolve(requestForUser("staffer"));
    expect(p2.roles).toContain("finance");
    expect(p2.roles).toContain("ops");
  });
});
