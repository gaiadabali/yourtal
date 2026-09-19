import { describe, expect, it, beforeAll } from "vitest";
import { DrizzleBusinessOnboardingUnitOfWork } from "../persistence/drizzle-business-onboarding.unit-of-work";
import { clearBusinessTables, testBusinessDb } from "../persistence/business-db.test-helper";
import { DrizzleBusinessAccountRepository } from "../persistence/drizzle-business-account.repository";
import { createBusiness } from "./create-business.use-case";

function setup() {
  const db = testBusinessDb();
  const unitOfWork = new DrizzleBusinessOnboardingUnitOfWork(db);
  return { db, unitOfWork };
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
      "user-1",
    );

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.business.displayName).toBe("Kopi Kenangan");
    expect(value.owner).toMatchObject({
      userId: "user-1",
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
