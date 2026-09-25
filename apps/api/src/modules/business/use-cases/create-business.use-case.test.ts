import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { DrizzleBusinessOnboardingUnitOfWork } from "../persistence/drizzle-business-onboarding.unit-of-work";
import { clearBusinessTables, testBusinessDb } from "../persistence/business-db.test-helper";
import { DrizzleBusinessAccountRepository } from "../persistence/drizzle-business-account.repository";
import { createBusiness } from "./create-business.use-case";

/**
 * A fixture id unique to THIS FILE, not `"user-1"` shared with siblings —
 * see `business-db.test-helper.ts` for why that used to be unsafe.
 */
const OWNER_ID = "user-create-business-use-case";

function setup() {
  const db = testBusinessDb();
  const unitOfWork = new DrizzleBusinessOnboardingUnitOfWork(db);
  return { db, unitOfWork };
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

describe("createBusiness", () => {
  it("creates the business and joins the caller as owner", async () => {
    const { unitOfWork, db } = setup();

    const result = await createBusiness(
      unitOfWork,
      {
        legalName: "PT Kopi Kenangan Indonesia",
        displayName: "Kopi Kenangan",
        district: "Kemang",
        roles: ["advertiser"],
        logoUrl: null,
      },
      OWNER_ID,
    );

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.business.displayName).toBe("Kopi Kenangan");
    expect(value.owner).toMatchObject({
      userId: OWNER_ID,
      role: "owner",
      businessId: value.business.id,
    });
    expect(value.owner.joinedAt).not.toBeNull();
    // Read back through the repository rather than out of a fake's Map.
    // This is the assertion the in-memory version could not make: it proves
    // the row survived a real INSERT and round-tripped through Postgres
    // types, not that a Map returned what was put in it.
    const persisted = await new DrizzleBusinessAccountRepository(db).findById(value.business.id);
    expect(persisted).toStrictEqual(value.business);
  });

  it("surfaces a persistence failure as a Result rather than throwing", async () => {
    const failingUnitOfWork = {
      createBusinessWithOwner: () => Promise.reject(new Error("connection reset")),
    };

    const result = await createBusiness(
      failingUnitOfWork,
      {
        legalName: "PT Test Indonesia",
        displayName: "Test",
        district: "Kemang",
        roles: ["advertiser"],
        logoUrl: null,
      },
      "user-1",
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({ type: "persistence_failed" });
  });
});
