import { randomUUID } from "node:crypto";
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { DrizzleBusinessAccountRepository } from "./persistence/drizzle-business-account.repository";
import { DrizzleBusinessOnboardingUnitOfWork } from "./persistence/drizzle-business-onboarding.unit-of-work";
import { DrizzleTeamInvitationRepository } from "./persistence/drizzle-team-invitation.repository";
import { clearBusinessTables, testBusinessDb } from "./persistence/business-db.test-helper";
import type { Principal } from "@yourtal/authz/principal";
import type { FastifyRequest } from "fastify";
import type { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import type { InvitationMailer } from "./invitation-mailer";
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
  const invitations = new DrizzleTeamInvitationRepository(db);
  const unitOfWork = new DrizzleBusinessOnboardingUnitOfWork(db);
  const created = await unitOfWork.createBusinessWithOwner(
    {
      legalName: "PT Kopi Kenangan Indonesia",
      displayName: "Kopi Kenangan",
      taxIdKind: "NPWP",
      taxIdValue: "1234567890123456",
      addressState: null,
      addressPostcode: null,
      addressCity: "Jakarta",
      roles: ["advertiser"],
      logoUrl: null,
      region: "ID" as const,
      currency: "IDR" as const,
      handle: `test-business-${randomUUID().slice(0, 8)}`,
      coverUrl: null,
    },
    OWNER_ID,
  );
  return { businesses, invitations, businessId: created.business.id };
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
  it("invites a member by email and mails the token, never returning it", async () => {
    const { businesses, invitations, businessId } = await setup();
    const principals = {
      resolve: vi.fn().mockResolvedValue(ownerPrincipal),
    } as unknown as AsyncPrincipalResolver;
    const sent: unknown[] = [];
    const mailer: InvitationMailer = {
      send: vi.fn((input) => Promise.resolve(void sent.push(input))),
    };
    const controller = new TeamInviteController(principals, businesses, invitations, mailer);

    const result = await controller.invite(
      businessId,
      { email: "marketer@example.com", role: "marketer" },
      {} as FastifyRequest,
    );

    expect(result).toMatchObject({
      businessId,
      email: "marketer@example.com",
      role: "marketer",
    });
    expect(result).not.toHaveProperty("token");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: "marketer@example.com",
      region: "ID",
      businessDisplayName: "Kopi Kenangan",
      role: "marketer",
    });
  });

  // "never calls the use-case when the PDP refuses" moved to
  // pdp.guard.test.ts: the guard now refuses before a controller method
  // is entered at all, so asserting it here would test a path that can no
  // longer be reached.
});
