import { describe, expect, it, vi, beforeAll } from "vitest";
import { DrizzleBusinessAccountRepository } from "./persistence/drizzle-business-account.repository";
import { DrizzleBusinessMemberRepository } from "./persistence/drizzle-business-member.repository";
import { DrizzleBusinessOnboardingUnitOfWork } from "./persistence/drizzle-business-onboarding.unit-of-work";
import { clearBusinessTables, testBusinessDb } from "./persistence/business-db.test-helper";
import type { Principal } from "@yourtal/authz/principal";
import type { FastifyRequest } from "fastify";
import { TeamInviteController } from "./team-invite.controller";

const ownerPrincipal: Principal = {
  id: "owner-1",
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
    },
    "owner-1",
  );
  return { businesses, members, businessId: created.business.id };
}

/**
 * A clean start, not only a clean finish.
 *
 * These tests share one database (the package runs serially for that
 * reason). A run that fails part-way leaves its rows behind, and the next
 * one then trips a unique index and fails for a reason unrelated to what it
 * tests — burying a real failure under a fake one. Clearing before is what
 * makes the suite repeatable; clearing after only helps when the previous
 * run got that far.
 */
beforeAll(async () => {
  await clearBusinessTables(testBusinessDb());
});

describe("TeamInviteController", () => {
  it("invites a member and records who invited them", async () => {
    const { businesses, members, businessId } = await setup();
    const principals = { resolve: vi.fn().mockReturnValue(ownerPrincipal) };
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
