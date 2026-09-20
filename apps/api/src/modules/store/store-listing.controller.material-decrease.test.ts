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

async function seedListing(settlementValueIdr: number) {
  const [location] = await db
    .insert(merchantLocations)
    .values({ id: randomUUID(), merchantId: TENANT, name: "Outlet", address: "Jl. Test", district: "Kemang" })
    .returning();
  if (location === undefined) throw new Error("failed to seed a merchant_location row");

  return repo.create(TENANT, {
    merchantName: "Material Decrease Test",
    title: "Voucher",
    description: "Description.",
    category: "retail",
    locationIds: [location.id],
    faceValueIdr: 10_000_000,
    settlementValueIdr,
    priceInPoints: 1_000,
    stockTotal: 5,
    transferable: false,
    partialRedemptionPolicy: "single_use_forfeit",
    minimumSpendIdr: null,
    expiresAt: "2027-01-01T00:00:00.000Z",
    status: "available",
    perUserLimit: undefined,
  });
}

describe("setSettlementValue against a real PDP", () => {
  it("allows an ordinary (non-material) decrease for an owner", async () => {
    const listing = await seedListing(1_000_000);
    const body = setSettlementValueSchema.parse({
      newSettlementValueIdr: 900_000, // 10% cut, below the 20% threshold
      reason: "Minor seasonal adjustment.",
    });
    const change = await controller.setSettlementValue(TENANT, listing.id, body, request);
    expect(change.updated.settlementValueIdr).toBe(900_000);
  });

  it("REFUSES a material decrease outright, even for the owner", async () => {
    const listing = await seedListing(1_000_000);
    const body = setSettlementValueSchema.parse({
      newSettlementValueIdr: 500_000, // 50% cut
      reason: "Big cut.",
    });
    await expect(
      controller.setSettlementValue(TENANT, listing.id, body, request),
    ).rejects.toMatchObject({ status: 403 });

    // And it did not apply, and left no audit trail for a change that never happened.
    const unchanged = await repo.findOwnedById(TENANT, listing.id);
    expect(unchanged?.settlementValueIdr).toBe(1_000_000);
    expect(await revisions.listForListing(listing.id)).toHaveLength(0);
  });
});
