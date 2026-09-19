import { describe, expect, it } from "vitest";
import { InMemoryBusinessOnboardingUnitOfWork } from "../persistence/in-memory-business-onboarding.unit-of-work";
import { InMemoryBusinessStore } from "../persistence/in-memory-business-store";
import { createBusiness } from "./create-business.use-case";

function setup() {
  const store = new InMemoryBusinessStore();
  const unitOfWork = new InMemoryBusinessOnboardingUnitOfWork(store);
  return { store, unitOfWork };
}

describe("createBusiness", () => {
  it("creates the business and joins the caller as owner", async () => {
    const { unitOfWork, store } = setup();

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
    expect(store.businesses.get(value.business.id)).toStrictEqual(value.business);
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
