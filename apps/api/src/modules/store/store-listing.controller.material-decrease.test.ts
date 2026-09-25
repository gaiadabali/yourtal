import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { Principal } from "@yourtal/authz/principal";
import { createPdpClient } from "@yourtal/authz/pdp-client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { setSettlementValueSchema } from "./dto/set-settlement-value.schema";
import { DrizzleListingPriceRevisionRepository } from "./persistence/drizzle-listing-price-revision.repository";
import { DrizzleListingRepository } from "./persistence/drizzle-listing.repository";
import { clearStoreTables, testStoreDb } from "./persistence/store-db.test-helper";
import { merchantLocations } from "./persistence/schema/listing.table";
import { StoreListingController } from "./store-listing.controller";

/**
 * Proves `policies/resource_policies/listing.yaml`'s two-person-approval
 * rule is actually reached from HTTP, not merely true in the policy repo --
 * `packages/authz`'s drift test only proves the TYPESCRIPT REGISTRY and the
 * POLICY agree on action names, not that a route ever asks the right
 * question. See `store-listing.controller.ts`'s doc comment on
 * `setSettlementValue` for why this needs a second, explicit PDP call rather
 * than `@Authorize`'s `attrsFrom`.
 */
const db = testStoreDb();
const repo = new DrizzleListingRepository(db);
const revisions = new DrizzleListingPriceRevisionRepository(db);
const pdp = createPdpClient({ baseUrl: "http://127.0.0.1:26592" });

const TENANT = "00000000-0000-4000-8000-0000000f0001";

function ownerPrincipal(): Principal {
  return {
    id: randomUUID(),
    roles: ["user", "business_user"],
    attr: { jurisdiction: "ID", businessRoles: { [TENANT]: "owner" }, isSuspended: false },
  };
}

const principals = { resolve: vi.fn().mockReturnValue(ownerPrincipal()) };
const controller = new StoreListingController(principals, repo, revisions, pdp);
const request = {} as FastifyRequest;

beforeAll(async () => {
  await clearStoreTables(db);
});

async function seedListing(settlementValueMinor: number) {
  const [location] = await db
    .insert(merchantLocations)
    .values({
      id: randomUUID(),
      merchantId: TENANT,
      name: "Outlet",
      address: "Jl. Test",
      district: "Kemang",
    })
    .returning();
  if (location === undefined) throw new Error("failed to seed a merchant_location row");

  return repo.create(TENANT, {
    merchantName: "Material Decrease Test",
    title: "Voucher",
    description: "Description.",
    category: "retail",
    locationIds: [location.id],
    currency: "IDR" as const,
    faceValueMinor: 100_000,
    settlementValueMinor,
    priceInPoints: 1_000,
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
}

describe("setSettlementValue against a real PDP", () => {
  it("allows an INCREASE for an owner -- the only non-material change there is", async () => {
    const listing = await seedListing(10_000);
    const body = setSettlementValueSchema.parse({
      newSettlementValueMinor: 11_000,
      reason: "Merchant agreed a better settlement rate.",
    });
    const change = await controller.setSettlementValue(TENANT, listing.id, body, request);
    expect(change.updated.settlementValueMinor).toBe(11_000);
  });

  // YT-0576: this case used to assert the OPPOSITE -- a 10% cut applied
  // straight through, "below the 20% threshold". The founder removed the
  // threshold rather than ratifying it, so the smallest possible decrease is
  // now material and must go through approval. Pinned at one rupiah
  // deliberately: a threshold reintroduced at any value makes this red, which
  // is the whole point of testing the boundary at its minimum rather than at
  // a comfortable 50%.
  it("REFUSES a one-rupiah decrease -- there is no threshold to sit under", async () => {
    const listing = await seedListing(10_000);
    const body = setSettlementValueSchema.parse({
      newSettlementValueMinor: 9_999,
      reason: "Rounding tidy-up.",
    });
    await expect(
      controller.setSettlementValue(TENANT, listing.id, body, request),
    ).rejects.toMatchObject({ status: 403 });

    const unchanged = await repo.findOwnedById(TENANT, listing.id);
    expect(unchanged?.settlementValueMinor).toBe(10_000);
    expect(await revisions.listForListing(listing.id)).toHaveLength(0);
  });

  // The bypass the threshold created, kept as a regression: under a 20% band
  // these two calls together cut S by 27.75% with nobody approving anything.
  it("REFUSES repeated small cuts that would compound past any old threshold", async () => {
    const listing = await seedListing(10_000);
    for (const value of [8_500, 7_225]) {
      const body = setSettlementValueSchema.parse({
        newSettlementValueMinor: value,
        reason: "Salami slice.",
      });
      await expect(
        controller.setSettlementValue(TENANT, listing.id, body, request),
      ).rejects.toMatchObject({ status: 403 });
    }
    const unchanged = await repo.findOwnedById(TENANT, listing.id);
    expect(unchanged?.settlementValueMinor).toBe(10_000);
  });

  it("REFUSES a material decrease outright, even for the owner", async () => {
    const listing = await seedListing(10_000);
    const body = setSettlementValueSchema.parse({
      newSettlementValueMinor: 5_000, // 50% cut
      reason: "Big cut.",
    });
    await expect(
      controller.setSettlementValue(TENANT, listing.id, body, request),
    ).rejects.toMatchObject({ status: 403 });

    // And it did not apply, and left no audit trail for a change that never happened.
    const unchanged = await repo.findOwnedById(TENANT, listing.id);
    expect(unchanged?.settlementValueMinor).toBe(10_000);
    expect(await revisions.listForListing(listing.id)).toHaveLength(0);
  });
});
