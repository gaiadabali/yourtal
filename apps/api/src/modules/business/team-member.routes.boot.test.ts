import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { sessionFor } from "../../shared/testing/session-for";
import type { TestSession } from "../../shared/testing/session-for";
import { DrizzleBusinessMemberRepository } from "./persistence/drizzle-business-member.repository";
import { DrizzleBusinessOnboardingUnitOfWork } from "./persistence/drizzle-business-onboarding.unit-of-work";
import { testBusinessDb } from "./persistence/business-db.test-helper";
import { businessMembers } from "./persistence/schema/business-member.table";

/**
 * YT-0580 — `PATCH /api/:tenantId/business/team/:userId/role` against a
 * LIVE Cerbos and a LIVE use-case, over a real HTTP round trip.
 *
 * ## Why this file exists
 *
 * The bug this ticket fixes was invisible to every test that already
 * existed. `change-member-role.use-case.test.ts` calls the use-case
 * function directly, so it never went near `@Authorize` or the PDP.
 * `team_test.yaml` asserts the CEL rule against hand-built attribute
 * values, so it never went near what `TeamMemberController.changeRole`
 * actually sends. Neither layer could see that the two disagreed: the PDP
 * was asked about the wrong role, and the use-case was not asked at all.
 * Same class of gap `store-listing.routes.boot.test.ts` records for
 * `set_settlement_value` — this file is that pattern applied here.
 *
 * Existence is under test on purpose, unlike the listing boot test: a
 * 404 would hide the very thing this file exists to prove (that an owner's
 * stored role, not a 403 door check, is what stops the demotion), so real
 * rows are seeded via the same Drizzle repositories the use-case tests use.
 *
 * 1.5.a: every actor is a real, registered account via `sessionFor` — a
 * fixed literal like the old `"admin-boot-1"` has no `identity.user_profile`
 * row, so `AsyncPrincipalResolver`'s 1.5.b overlay would never see the
 * `business.business_members` rows this file seeds for it, no matter how
 * real those rows are. Each test gets its own fresh business, since a new
 * random user backs every actor now rather than a handful of shared literals
 * a `beforeEach` used to reset.
 */
let app: NestFastifyApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

async function seed() {
  // 1.5.b's F2 region wall denies a caller whose own region differs from
  // the resource's — the seeded business below is region ID (a real
  // Indonesian merchant), so every actor who is meant to succeed against it
  // has to be ID too. `stranger` has no membership at this business at all,
  // so their own region does not matter for what this file tests.
  const [owner, admin, marketer, stranger] = await Promise.all([
    sessionFor(app, { jurisdiction: "ID" }),
    sessionFor(app, { jurisdiction: "ID" }),
    sessionFor(app, { jurisdiction: "ID" }),
    sessionFor(app),
  ]);

  const db = testBusinessDb();
  const members = new DrizzleBusinessMemberRepository(db);
  const unitOfWork = new DrizzleBusinessOnboardingUnitOfWork(db);
  const created = await unitOfWork.createBusinessWithOwner(
    {
      legalName: "PT Kopi Kenangan Indonesia",
      displayName: "Kopi Kenangan",
      district: "Kemang",
      roles: ["advertiser"],
      logoUrl: null,
      region: "ID" as const,
      currency: "IDR" as const,
      handle: `test-business-${randomUUID().slice(0, 8)}`,
      coverUrl: null,
    },
    owner.userId,
  );
  const businessId = created.business.id;
  await members.addMember({
    businessId,
    userId: admin.userId,
    role: "admin",
    invitedByUserId: owner.userId,
  });
  await members.addMember({
    businessId,
    userId: marketer.userId,
    role: "marketer",
    invitedByUserId: owner.userId,
  });
  // `addMember` leaves `joined_at` NULL — an outstanding invite, not yet a
  // membership `BusinessMembershipReader.listForUser` (1.5.b) will return.
  // These tests are about an ALREADY-accepted admin/marketer acting on the
  // team, so mark both as joined directly; there is no accept-invite route
  // to drive instead, and this file is not testing the invite flow itself.
  await markJoined(db, businessId, admin.userId);
  await markJoined(db, businessId, marketer.userId);
  return { businessId, members, owner, admin, marketer, stranger };
}

async function markJoined(
  db: ReturnType<typeof testBusinessDb>,
  businessId: string,
  userId: string,
): Promise<void> {
  await db
    .update(businessMembers)
    .set({ joinedAt: new Date() })
    .where(and(eq(businessMembers.businessId, businessId), eq(businessMembers.userId, userId)));
}

function cookieHeader(session: TestSession): { readonly cookie: string } {
  return { cookie: session.cookie };
}

describe("PATCH .../business/team/:userId/role against a live PDP and a live use-case", () => {
  it("refuses a business admin demoting the owner (the YT-0580 exploit, reproduced over HTTP)", async () => {
    const { businessId, members, owner, admin } = await seed();

    const response = await app.inject({
      method: "PATCH",
      url: `/api/${businessId}/business/team/${owner.userId}/role`,
      headers: cookieHeader(admin),
      payload: { role: "admin" },
    });

    // The post-read `requireAction` call (layer B) sits BEFORE the
    // use-case in `changeRole`'s body, so on the happy path it is the one
    // that answers first: 403, not the use-case's 400. `cannot_change_owner
    // _role` (layer A, the use-case guard) is exercised directly below by
    // sabotaging layer B — see `layer B disabled` in this file's sibling
    // sabotage notes, and `change-member-role.use-case.test.ts` for layer A
    // proven at the use-case level.
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "forbidden" });
    expect((await members.findMember(businessId, owner.userId))?.role).toBe("owner");
  });

  it("still allows a business admin to change an ordinary member's role", async () => {
    const { businessId, members, admin, marketer } = await seed();

    const response = await app.inject({
      method: "PATCH",
      url: `/api/${businessId}/business/team/${marketer.userId}/role`,
      headers: cookieHeader(admin),
      payload: { role: "analyst" },
    });

    expect(response.statusCode).toBe(200);
    expect((await members.findMember(businessId, marketer.userId))?.role).toBe("analyst");
  });

  it("refuses a caller with no role at this tenant (pins that the route exists at all)", async () => {
    const { businessId, owner, stranger } = await seed();

    const response = await app.inject({
      method: "PATCH",
      url: `/api/${businessId}/business/team/${owner.userId}/role`,
      headers: cookieHeader(stranger),
      payload: { role: "admin" },
    });

    expect(response.statusCode).toBe(403);
  });
});

/**
 * YT-0581 -- `DELETE /api/:tenantId/business/team/:userId` against a LIVE
 * Cerbos and a LIVE use-case, over a real HTTP round trip.
 *
 * Sibling of the YT-0580 suite above, and not exploitable the way that one
 * was: `remove-member.use-case.ts:28-33` already refuses on the target's
 * stored role, so an admin removing the owner has always ended in an error
 * here. What this file proves is WHICH layer answers first, because that
 * changed. Before this fix, `TeamMemberController.remove`'s `@Authorize`
 * sent no `targetRole` at all, so `ownership-moves-only-by-transfer` could
 * never fire for `remove_member` and the PDP call returned `EFFECT_ALLOW`;
 * the use-case's own guard was consequently the ONLY thing stopping the
 * removal, answering with `cannot_remove_owner` (400). Now that the
 * controller makes a second, post-read `requireAction` call supplying the
 * target's real stored role, the PDP itself denies first, so the same
 * request now surfaces as `forbidden` (403) before the use-case ever runs.
 */
describe("DELETE .../business/team/:userId against a live PDP and a live use-case", () => {
  it("refuses a business admin removing the owner, and the PDP answers first (YT-0581)", async () => {
    const { businessId, members, owner, admin } = await seed();

    const response = await app.inject({
      method: "DELETE",
      url: `/api/${businessId}/business/team/${owner.userId}`,
      headers: cookieHeader(admin),
    });

    // The post-read `requireAction` call now sits BEFORE the use-case in
    // `remove`'s body, so it is the one that answers: 403, not the
    // use-case's 400 `cannot_remove_owner`. That guard still exists and is
    // exercised directly at the use-case level in
    // `remove-member.use-case.test.ts` -- this file only proves the PDP
    // itself no longer stays silent on this action.
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "forbidden" });
    expect((await members.findMember(businessId, owner.userId))?.role).toBe("owner");
  });

  it("still allows a business admin to remove an ordinary member", async () => {
    const { businessId, members, admin, marketer } = await seed();

    const response = await app.inject({
      method: "DELETE",
      url: `/api/${businessId}/business/team/${marketer.userId}`,
      headers: cookieHeader(admin),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ removed: true });
    expect(await members.findMember(businessId, marketer.userId)).toBeNull();
  });

  it("refuses a caller with no role at this tenant (pins that the route exists at all)", async () => {
    const { businessId, owner, stranger } = await seed();

    const response = await app.inject({
      method: "DELETE",
      url: `/api/${businessId}/business/team/${owner.userId}`,
      headers: cookieHeader(stranger),
    });

    expect(response.statusCode).toBe(403);
  });
});
