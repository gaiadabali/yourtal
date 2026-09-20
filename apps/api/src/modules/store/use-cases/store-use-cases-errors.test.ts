import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { DrizzleListingRepository } from "../persistence/drizzle-listing.repository";
import { clearStoreTables, testStoreDb } from "../persistence/store-db.test-helper";
import { merchantLocations } from "../persistence/schema/listing.table";
import { createListing } from "./create-listing.use-case";
import { editListing } from "./edit-listing.use-case";
import { getMyListing } from "./get-my-listing.use-case";
import { setListingLifecycle } from "./set-listing-lifecycle.use-case";
import { setSettlementValue } from "./set-settlement-value.use-case";

/**
 * The error paths every use-case's Result union promises (docs/13b section
 * 4) — against real Postgres, not a mocked repository. Mocking the
 * repository here would prove the use-case calls a method; it would prove
 * nothing about `locationsBelongToMerchant` actually querying
 * `merchant_location`, which is the constraint that matters.
 */
const db = testStoreDb();
const repo = new DrizzleListingRepository(db);
const MERCHANT = "00000000-0000-4000-8000-0000000e0001";

beforeAll(async () => {
  await clearStoreTables(db);
});

async function seedListing() {
  const [location] = await db
    .insert(merchantLocations)
    .values({
      id: randomUUID(),
      merchantId: MERCHANT,
      name: "Outlet",
      address: "Jl. Test",
      district: "Kemang",
    })
    .returning();
  if (location === undefined) throw new Error("failed to seed a merchant_location row");

  const result = await createListing(repo, MERCHANT, {
    merchantName: "Error Path Merchant",
    title: "Voucher",
    description: "Description.",
    category: "services",
    locationIds: [location.id],
    faceValueIdr: 1_000_000,
    settlementValueIdr: 300_000,
    priceInPoints: 500,
    stockTotal: 5,
    transferable: false,
    partialRedemptionPolicy: "single_use_forfeit",
    minimumSpendIdr: null,
    expiresAt: "2027-01-01T00:00:00.000Z",
    status: "available",
    perUserLimit: undefined,
  });
  if (result.isErr()) throw new Error("test setup: failed to create a listing");
  return result.value;
}

describe("createListing", () => {
  it("refuses a location that belongs to nobody", async () => {
    const result = await createListing(repo, MERCHANT, {
      merchantName: "M",
      title: "T",
      description: "D",
      category: "services",
      locationIds: [randomUUID()],
      faceValueIdr: 1,
      settlementValueIdr: 1,
      priceInPoints: 1,
      stockTotal: 1,
      transferable: false,
      partialRedemptionPolicy: "single_use_forfeit",
      minimumSpendIdr: null,
      expiresAt: "2027-01-01T00:00:00.000Z",
      status: "available",
      perUserLimit: undefined,
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({ type: "invalid_locations" });
  });
});

describe("editListing", () => {
  it("reports listing_not_found for a listing outside the tenant", async () => {
    const listing = await seedListing();
    const otherTenant = "00000000-0000-4000-8000-0000000e0002";
    const result = await editListing(repo, otherTenant, listing.id, { title: "Hijacked" });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({ type: "listing_not_found" });
  });
});

describe("getMyListing", () => {
  it("reports listing_not_found rather than returning someone else's listing", async () => {
    const result = await getMyListing(repo, MERCHANT, randomUUID());
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({ type: "listing_not_found" });
  });
});

describe("setSettlementValue", () => {
  it("reports listing_not_found for a listing outside the tenant", async () => {
    const listing = await seedListing();
    const otherTenant = "00000000-0000-4000-8000-0000000e0003";
    const result = await setSettlementValue(repo, otherTenant, listing.id, 1, "actor", "reason");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({ type: "listing_not_found" });
  });
});

describe("setListingLifecycle", () => {
  it("refuses to resurrect a retired listing", async () => {
    const listing = await seedListing();
    const retired = await setListingLifecycle(repo, MERCHANT, listing.id, "retired");
    expect(retired.isOk()).toBe(true);

    const revived = await setListingLifecycle(repo, MERCHANT, listing.id, "active");
    expect(revived.isErr()).toBe(true);
    expect(revived._unsafeUnwrapErr()).toMatchObject({
      type: "invalid_lifecycle_transition",
      from: "retired",
      to: "active",
    });
  });

  it("allows pause then resume", async () => {
    const listing = await seedListing();
    expect((await setListingLifecycle(repo, MERCHANT, listing.id, "paused")).isOk()).toBe(true);
    expect((await setListingLifecycle(repo, MERCHANT, listing.id, "active")).isOk()).toBe(true);
  });

  it("reports listing_not_found for a listing that does not exist", async () => {
    const result = await setListingLifecycle(repo, MERCHANT, randomUUID(), "paused");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({ type: "listing_not_found" });
  });
});
