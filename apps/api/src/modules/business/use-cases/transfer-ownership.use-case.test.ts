import { randomUUID } from "node:crypto";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { DrizzleBusinessAccountRepository } from "../persistence/drizzle-business-account.repository";
import { DrizzleBusinessMemberRepository } from "../persistence/drizzle-business-member.repository";
import { DrizzleBusinessOnboardingUnitOfWork } from "../persistence/drizzle-business-onboarding.unit-of-work";
import { DrizzleTransferOwnershipUnitOfWork } from "../persistence/drizzle-transfer-ownership.unit-of-work";
import { clearBusinessTables, testBusinessDb } from "../persistence/business-db.test-helper";
import { transferOwnership } from "./transfer-ownership.use-case";

/**
 * A fixture id unique to THIS FILE, not `"owner-1"` shared with siblings —
 * see `business-db.test-helper.ts` for why that used to be unsafe.
 */
const OWNER_ID = "owner-transfer-ownership";

async function setup() {
  const db = testBusinessDb();
  const businesses = new DrizzleBusinessAccountRepository(db);
  const members = new DrizzleBusinessMemberRepository(db);
  const unitOfWork = new DrizzleBusinessOnboardingUnitOfWork(db);
  const transferUnitOfWork = new DrizzleTransferOwnershipUnitOfWork(db);
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
  const businessId = created.business.id;
  await members.addMember({
    businessId,
    userId: "future-owner",
    role: "admin",
    invitedByUserId: OWNER_ID,
  });
  return { businesses, members, transferUnitOfWork, businessId };
}

beforeAll(async () => {
  await clearBusinessTables(testBusinessDb(), [OWNER_ID]);
});

afterAll(async () => {
  await clearBusinessTables(testBusinessDb(), [OWNER_ID]);
});

describe("transferOwnership", () => {
  it("demotes the current owner to admin and promotes the target to owner", async () => {
    const { businesses, members, transferUnitOfWork, businessId } = await setup();

    const result = await transferOwnership(businesses, transferUnitOfWork, {
      businessId,
      currentOwnerUserId: OWNER_ID,
      newOwnerUserId: "future-owner",
    });

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.previousOwner).toMatchObject({ userId: OWNER_ID, role: "admin" });
    expect(value.newOwner).toMatchObject({ userId: "future-owner", role: "owner" });

    // Read back through the repository, not the use-case's own return value —
    // proves the transaction actually committed both writes.
    expect((await members.findMember(businessId, OWNER_ID))?.role).toBe("admin");
    expect((await members.findMember(businessId, "future-owner"))?.role).toBe("owner");
  });

  it("rejects transferring to someone who is not yet a member", async () => {
    const { businesses, transferUnitOfWork, businessId } = await setup();

    const result = await transferOwnership(businesses, transferUnitOfWork, {
      businessId,
      currentOwnerUserId: OWNER_ID,
      newOwnerUserId: "nobody",
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toStrictEqual({
      type: "target_not_member",
      userId: "nobody",
    });
  });

  it("rejects a business that does not exist", async () => {
    const { transferUnitOfWork } = await setup();
    const db = testBusinessDb();
    const businesses = new DrizzleBusinessAccountRepository(db);

    const result = await transferOwnership(businesses, transferUnitOfWork, {
      businessId: "00000000-0000-4000-8000-000000000000",
      currentOwnerUserId: OWNER_ID,
      newOwnerUserId: "future-owner",
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("business_not_found");
  });
});
