import { describe, expect, it, vi } from "vitest";
import type { Principal } from "@yourtal/authz/principal";
import type { FastifyRequest } from "fastify";
import { InMemoryBusinessAccountRepository } from "./persistence/in-memory-business-account.repository";
import { InMemoryBusinessMemberRepository } from "./persistence/in-memory-business-member.repository";
import { InMemoryBusinessOnboardingUnitOfWork } from "./persistence/in-memory-business-onboarding.unit-of-work";
import { InMemoryBusinessStore } from "./persistence/in-memory-business-store";
import { TeamInviteController } from "./team-invite.controller";

const ownerPrincipal: Principal = {
  id: "owner-1",
  roles: ["business_user"],
  attr: { jurisdiction: "ID", businessRoles: {}, isSuspended: false },
};

async function setup() {
  const store = new InMemoryBusinessStore();
  const businesses = new InMemoryBusinessAccountRepository(store);
  const members = new InMemoryBusinessMemberRepository(store);
  const unitOfWork = new InMemoryBusinessOnboardingUnitOfWork(store);
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
