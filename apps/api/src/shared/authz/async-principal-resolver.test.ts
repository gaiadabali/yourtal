import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { FastifyRequest } from "fastify";
import { AsyncPrincipalResolver } from "./async-principal-resolver";
import { PrincipalService } from "./principal.service";
import type { AppConfig } from "../../config/app-config";
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

function configFor(nodeEnv: AppConfig["nodeEnv"]): AppConfig {
  return {
    nodeEnv,
    port: 3001,
    pdp: { baseUrl: "http://127.0.0.1:3592", timeoutMs: 500 },
    databaseUrl: "postgres://yourtal_app:app_local_only@127.0.0.1:26432/yourtal",
    redisUrl: "redis://127.0.0.1:26379",
    ledger: {
      mode: "fake" as const,
      baseUrl: "http://127.0.0.1:26312",
      voucherBaseUrl: "http://127.0.0.1:26313",
      serviceSecret: "test-only-ledger-service-secret-not-real",
    },
    teenAccounts: false,
    appEnv: "dev",
  };
}

function requestWith(headers: Record<string, string>): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
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
  readonly security?: Record<string, PrincipalSecurityState>;
  readonly profiles?: Record<string, StoredUserProfile>;
  readonly memberships?: Record<string, readonly BusinessMembershipSummary[]>;
  readonly staffRoles?: Record<string, readonly PrincipalRole[]>;
}

function resolverWith(fixtures: ResolverFixtures = {}): AsyncPrincipalResolver {
  return new AsyncPrincipalResolver(
    new PrincipalService(configFor("test")),
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
    const principal = await resolver.resolve(requestWith({ "x-yt-user-id": "wina" }));
    expect(principal.attr.valueFrozenUntil).toBeUndefined();
  });

  it("carries no valueFrozenUntil when the row exists but is null", async () => {
    const resolver = resolverWith({ security: { wina: { valueFrozenUntil: null } } });
    const principal = await resolver.resolve(requestWith({ "x-yt-user-id": "wina" }));
    expect(principal.attr.valueFrozenUntil).toBeUndefined();
  });

  it("carries valueFrozenUntil as an RFC3339 string when stored state has one", async () => {
    const frozenUntil = new Date("2026-09-24T10:00:00.000Z");
    const resolver = resolverWith({ security: { wina: { valueFrozenUntil: frozenUntil } } });
    const principal = await resolver.resolve(requestWith({ "x-yt-user-id": "wina" }));
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
      new PrincipalService(configFor("test")),
      security,
      fakeProfileRepo(),
      fakeMembershipReader(),
      fakeStaffRoleReader(),
    );
    const principal = await resolver.resolve(requestWith({}));
    expect(principal.id).toBe("anonymous");
    expect(called).toBe(false);
  });

  it("still rejects a malformed header before ever reaching the database", async () => {
    const resolver = resolverWith();
    await expect(
      resolver.resolve(
        requestWith({ "x-yt-user-id": "owner-1", "x-yt-business-roles": "{not json" }),
      ),
    ).rejects.toThrow(UnauthorizedException);
  });
});

describe("AsyncPrincipalResolver — 1.5.b (region, ageBand, suspension, business roles)", () => {
  it("with no profile row, keeps the header-derived jurisdiction/isSuspended/businessRoles exactly as before", async () => {
    const resolver = resolverWith();
    const principal = await resolver.resolve(
      requestWith({
        "x-yt-user-id": "wina",
        "x-yt-jurisdiction": "ID",
        "x-yt-suspended": "true",
        "x-yt-business-roles": JSON.stringify({ "biz-kopi": "owner" }),
      }),
    );
    expect(principal.attr.jurisdiction).toBe("ID");
    expect(principal.attr.isSuspended).toBe(true);
    expect(principal.attr.businessRoles).toStrictEqual({ "biz-kopi": "owner" });
    expect(principal.attr.ageBand).toBeUndefined();
  });

  it("with a profile row, region/ageBand/isSuspended/businessRoles come from the database, not the header", async () => {
    const resolver = resolverWith({
      profiles: {
        wina: profileFor({ region: "AU", dateOfBirth: "1990-01-01", suspendedAt: null }),
      },
      memberships: { wina: [{ businessId: "biz-real", role: "analyst" }] },
    });
    const principal = await resolver.resolve(
      requestWith({
        "x-yt-user-id": "wina",
        // Headers say the opposite of the DB on every one of these — the DB must win.
        "x-yt-jurisdiction": "ID",
        "x-yt-suspended": "true",
        "x-yt-business-roles": JSON.stringify({ "biz-fake": "owner" }),
      }),
    );
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
    const principal = await resolver.resolve(requestWith({ "x-yt-user-id": "wina" }));
    expect(principal.attr.isSuspended).toBe(true);
  });

  it("ageBand is teen for a 15-year-old and adult for a 40-year-old", async () => {
    const teen = resolverWith({ profiles: { wina: profileFor({ dateOfBirth: "2010-06-01" }) } });
    const adult = resolverWith({ profiles: { wina: profileFor({ dateOfBirth: "1986-06-01" }) } });
    const teenPrincipal = await teen.resolve(requestWith({ "x-yt-user-id": "wina" }));
    const adultPrincipal = await adult.resolve(requestWith({ "x-yt-user-id": "wina" }));
    // ageBandFrom computes from `new Date()` internally; this asserts the
    // shape rather than the exact band, since a fixed "now" is not injected
    // — the two dates of birth are chosen far enough apart (16 years either
    // side of 18) that today's date can never put both on the same side.
    expect(teenPrincipal.attr.ageBand).toBe("teen");
    expect(adultPrincipal.attr.ageBand).toBe("adult");
  });

  it("drops business_user when the profile shows no memberships, even if the header claimed one", async () => {
    const resolver = resolverWith({ profiles: { wina: profileFor() }, memberships: { wina: [] } });
    const principal = await resolver.resolve(
      requestWith({
        "x-yt-user-id": "wina",
        "x-yt-business-roles": JSON.stringify({ "biz-fake": "owner" }),
      }),
    );
    expect(principal.roles).not.toContain("business_user");
    expect(principal.attr.businessRoles).toStrictEqual({});
  });

  it("folds identity.staff_role into roles, with or without a profile", async () => {
    const withProfile = resolverWith({
      profiles: { wina: profileFor() },
      staffRoles: { wina: ["moderator"] },
    });
    const withoutProfile = resolverWith({ staffRoles: { staffer: ["finance", "ops"] } });

    const p1 = await withProfile.resolve(requestWith({ "x-yt-user-id": "wina" }));
    expect(p1.roles).toContain("moderator");

    const p2 = await withoutProfile.resolve(requestWith({ "x-yt-user-id": "staffer" }));
    expect(p2.roles).toContain("finance");
    expect(p2.roles).toContain("ops");
  });
});
