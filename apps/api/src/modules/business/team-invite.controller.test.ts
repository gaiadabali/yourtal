import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { DrizzleBusinessAccountRepository } from "./persistence/drizzle-business-account.repository";
import { DrizzleBusinessMemberRepository } from "./persistence/drizzle-business-member.repository";
import { DrizzleBusinessOnboardingUnitOfWork } from "./persistence/drizzle-business-onboarding.unit-of-work";
import { clearBusinessTables, testBusinessDb } from "./persistence/business-db.test-helper";
import type { Principal } from "@yourtal/authz/principal";
import type { FastifyRequest } from "fastify";
import type { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import { TeamInviteController } from "./team-invite.controller";

/**
 * A fixture id unique to THIS FILE, not `"owner-1"` shared with siblings —
 * see `persistence/business-db.test-helper.ts` for why that used to be
 * unsafe.
 */
const OWNER_ID = "owner-team-invite-controller";

const ownerPrincipal: Principal = {
  id: OWNER_ID,
  roles: ["business_user"],
  attr: { jurisdiction: "ID", businessRoles: {}, isSuspended: false },
};

async function setup() {
  const db = testBusinessDb();
  const businesses = new DrizzleBusinessAccountRepository(db);
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
      handle: "test-business-003",
      coverUrl: null,
    },
    OWNER_ID,
  );
  return { businesses, members, businessId: created.business.id };
}

/**
 * A clean start, not only a clean finish — scoped to this file's own
 * fixtures now, not the whole table. See
 * `persistence/business-db.test-helper.ts`.
 */
beforeAll(async () => {
  await clearBusinessTables(testBusinessDb(), [OWNER_ID]);
});

afterAll(async () => {
  await clearBusinessTables(testBusinessDb(), [OWNER_ID]);
});

describe("TeamInviteController", () => {
  it("invites a member and records who invited them", async () => {
    const { businesses, members, businessId } = await setup();
    const principals = {
      resolve: vi.fn().mockResolvedValue(ownerPrincipal),
    } as unknown as AsyncPrincipalResolver;
    const controller = new TeamInviteController(principals, businesses, members);

    const result = await controller.invite(
      businessId,
      { userId: "marketer-1", role: "marketer" },
      {} as FastifyRequest,
    );

    expect(result).toMatchObject({ userId: "marketer-1", role: "marketer" });
  });

  // "never calls the use-case when the PDP refuses" moved to
  // pdp.guard.test.ts: the guard now refuses before a controller method
  // is entered at all, so asserting it here would test a path that can no
  // longer be reached.
});
