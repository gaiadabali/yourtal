import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { DrizzleListingRepository } from "../persistence/drizzle-listing.repository";
import { DrizzleSettlementDecreaseRequestRepository } from "../persistence/drizzle-settlement-decrease-request.repository";
import { clearStoreTables, testStoreDb } from "../persistence/store-db.test-helper";
import { merchantLocations } from "../persistence/schema/listing.table";
import { approveSettlementDecrease } from "./approve-settlement-decrease.use-case";
import { createListing } from "./create-listing.use-case";
import { editListing } from "./edit-listing.use-case";
import { getMyListing } from "./get-my-listing.use-case";
import { proposeSettlementDecrease } from "./propose-settlement-decrease.use-case";
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
const decreaseRequests = new DrizzleSettlementDecreaseRequestRepository(db);
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
    currency: "IDR" as const,
    faceValueMinor: 10_000,
    settlementValueMinor: 3_000,
    priceInPoints: 500,
    stockTotal: 5,
    transferable: false,
    partialRedemptionPolicy: "single_use_forfeit",
    region: "ID" as const,
    audience: "all_ages" as const,
    contentCategory: "food-and-drink" as const,
    imageUrl: "https://cdn.example.com/listing.jpg",
    channel: "in_store" as const,
    partialRedemption: "single_use" as const,
    minimumSpendMinor: null,
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
      currency: "IDR" as const,
      faceValueMinor: 1,
      settlementValueMinor: 1,
      priceInPoints: 1,
      stockTotal: 1,
      transferable: false,
      partialRedemptionPolicy: "single_use_forfeit",
      region: "ID" as const,
      audience: "all_ages" as const,
      contentCategory: "food-and-drink" as const,
      imageUrl: "https://cdn.example.com/listing.jpg",
      channel: "in_store" as const,
      partialRedemption: "single_use" as const,
      minimumSpendMinor: null,
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

describe("proposeSettlementDecrease (YT-0575)", () => {
  it("reports listing_not_found for a listing outside the tenant", async () => {
    const listing = await seedListing();
    const otherTenant = "00000000-0000-4000-8000-0000000e0004";
    const result = await proposeSettlementDecrease(
      repo,
      decreaseRequests,
      otherTenant,
      listing.id,
      1,
      "actor",
      "reason",
    );
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({ type: "listing_not_found" });
  });

  // YT-0576: this asserted the OPPOSITE until the founder removed the 20%
  // placeholder rather than ratifying it -- a ~3% cut used to be refused here
  // as "not material". Every decrease is material now, so the small cut is a
  // VALID proposal and this is the case that proves the threshold is gone.
  //
  // Note the actor is a real uuid. It was the string "actor" while this test
  // expected an error, which worked only because materiality short-circuited
  // before persistence; flipping the assertion pushed the call through to the
  // database and the non-uuid surfaced as persistence_failed. A test that
  // never reaches the write cannot tell you its arguments are wrong.
  it("accepts a ~3% cut -- there is no threshold below which a decrease is immaterial", async () => {
    const listing = await seedListing(); // settlementValueMinor: 3_000
    const result = await proposeSettlementDecrease(
      repo,
      decreaseRequests,
      MERCHANT,
      listing.id,
      2_900,
      "00000000-0000-4000-8000-0000000e0009",
      "reason",
    );
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toMatchObject({
      listingId: listing.id,
      proposedSettlementValueMinor: 2_900,
    });
  });

  it("reports not_a_material_decrease for an increase", async () => {
    const listing = await seedListing();
    const result = await proposeSettlementDecrease(
      repo,
      decreaseRequests,
      MERCHANT,
      listing.id,
      4_000,
      "actor",
      "reason",
    );
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({ type: "not_a_material_decrease" });
  });

  it("reports decrease_already_pending for a second request while one is outstanding", async () => {
    const listing = await seedListing();
    // A real UUID, not the "actor" placeholder the not-reached error-path
    // tests above use -- this call actually inserts, and requested_by is
    // `uuid NOT NULL`.
    const requester = randomUUID();
    const first = await proposeSettlementDecrease(
      repo,
      decreaseRequests,
      MERCHANT,
      listing.id,
      1_000,
      requester,
      "first",
    );
    expect(first.isOk()).toBe(true);

    const second = await proposeSettlementDecrease(
      repo,
      decreaseRequests,
      MERCHANT,
      listing.id,
      500,
      requester,
      "second",
    );
    expect(second.isErr()).toBe(true);
    expect(second._unsafeUnwrapErr()).toMatchObject({ type: "decrease_already_pending" });
  });
});

describe("approveSettlementDecrease (YT-0575)", () => {
  it("reports listing_not_found for a listing outside the tenant", async () => {
    const listing = await seedListing();
    const otherTenant = "00000000-0000-4000-8000-0000000e0005";
    const result = await approveSettlementDecrease(
      repo,
      decreaseRequests,
      otherTenant,
      listing.id,
      randomUUID(),
      "approver",
    );
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({ type: "listing_not_found" });
  });

  it("reports approval_refused for a self-approval attempt", async () => {
    const listing = await seedListing();
    const requester = randomUUID();
    const proposed = await proposeSettlementDecrease(
      repo,
      decreaseRequests,
      MERCHANT,
      listing.id,
      1_000,
      requester,
      "reason",
    );
    if (proposed.isErr()) throw new Error("test setup: failed to propose a decrease");

    const result = await approveSettlementDecrease(
      repo,
      decreaseRequests,
      MERCHANT,
      listing.id,
      proposed.value.id,
      requester, // same person
    );
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({ type: "approval_refused" });
  });

  it("reports approval_refused for a request that does not exist", async () => {
    const listing = await seedListing();
    const result = await approveSettlementDecrease(
      repo,
      decreaseRequests,
      MERCHANT,
      listing.id,
      randomUUID(),
      randomUUID(),
    );
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({ type: "approval_refused" });
  });
});
