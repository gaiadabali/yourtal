import { randomUUID } from "node:crypto";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { DrizzleBusinessAccountRepository } from "../persistence/drizzle-business-account.repository";
import { DrizzleBusinessOnboardingUnitOfWork } from "../persistence/drizzle-business-onboarding.unit-of-work";
import { DrizzleTeamInvitationRepository } from "../persistence/drizzle-team-invitation.repository";
import { clearBusinessTables, testBusinessDb } from "../persistence/business-db.test-helper";
import { createBusiness } from "./create-business.use-case";
import { inviteMember } from "./invite-member.use-case";

/**
 * A fixture id unique to THIS FILE, not `"owner-1"` shared with siblings —
 * see `business-db.test-helper.ts` for why that used to be unsafe.
 */
const OWNER_ID = "owner-invite-member";

async function setupWithBusiness() {
  const db = testBusinessDb();
  const businesses = new DrizzleBusinessAccountRepository(db);
  const invitations = new DrizzleTeamInvitationRepository(db);
  const unitOfWork = new DrizzleBusinessOnboardingUnitOfWork(db);
  const created = await createBusiness(
    unitOfWork,
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
  const businessId = created._unsafeUnwrap().business.id;
  return { businesses, invitations, businessId };
}

/**
 * A clean start, not only a clean finish — scoped to this file's own
 * fixtures now, not the whole table. See `business-db.test-helper.ts`.
 */
beforeAll(async () => {
  await clearBusinessTables(testBusinessDb(), [OWNER_ID]);
});

afterAll(async () => {
  await clearBusinessTables(testBusinessDb(), [OWNER_ID]);
});

describe("inviteMember", () => {
  it("creates an open invitation and hands back a token, unstored", async () => {
    const { businesses, invitations, businessId } = await setupWithBusiness();

    const result = await inviteMember(businesses, invitations, {
      businessId,
      email: "marketer@example.com",
      role: "marketer",
      invitedByUserId: OWNER_ID,
    });

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.invitation).toMatchObject({
      businessId,
      email: "marketer@example.com",
      role: "marketer",
      acceptedAt: null,
    });
    expect(value.token.length).toBeGreaterThan(0);
  });

  it("rejects a second open invite to the same address", async () => {
    const { businesses, invitations, businessId } = await setupWithBusiness();
    (
      await inviteMember(businesses, invitations, {
        businessId,
        email: "marketer@example.com",
        role: "marketer",
        invitedByUserId: OWNER_ID,
      })
    )._unsafeUnwrap();

    const result = await inviteMember(businesses, invitations, {
      businessId,
      email: "marketer@example.com",
      role: "analyst",
      invitedByUserId: OWNER_ID,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toStrictEqual({
      type: "invitation_already_open",
      email: "marketer@example.com",
    });
  });

  it("rejects an invite against a business that does not exist", async () => {
    const db = testBusinessDb();
    const businesses = new DrizzleBusinessAccountRepository(db);
    const invitations = new DrizzleTeamInvitationRepository(db);

    const result = await inviteMember(businesses, invitations, {
      businessId: "00000000-0000-4000-8000-000000000000",
      email: "marketer@example.com",
      role: "marketer",
      invitedByUserId: OWNER_ID,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("business_not_found");
  });
});
