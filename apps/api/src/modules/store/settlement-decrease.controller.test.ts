import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { Principal } from "@yourtal/authz/principal";
import { createPdpClient } from "@yourtal/authz/pdp-client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { proposeSettlementDecreaseSchema } from "./dto/propose-settlement-decrease.schema";
import { DrizzleListingRepository } from "./persistence/drizzle-listing.repository";
import { DrizzleSettlementDecreaseRequestRepository } from "./persistence/drizzle-settlement-decrease-request.repository";
import { clearStoreTables, testStoreDb } from "./persistence/store-db.test-helper";
import { merchantLocations } from "./persistence/schema/listing.table";
import { SettlementDecreaseController } from "./settlement-decrease.controller";

/**
 * The YT-0575 workflow end to end, against a real PDP and real Postgres --
 * mirroring `store-listing.controller.material-decrease.test.ts`'s proof
 * that a policy rule is actually reached from HTTP, not merely true on
 * paper.
 *
 * The self-approval case here is the ticket's central claim: a boundary
 * check (this controller's second, explicit PDP call) protects the
 * boundary; the WHERE clause inside
 * `SettlementDecreaseRequestRepository.approve` is what protects the data
 * if that boundary check is ever wrong. This suite drives the SAME
 * principal through propose then approve to prove the refusal holds even
 * with a real (not stubbed) Cerbos decision in front of it.
 */
const db = testStoreDb();
const listings = new DrizzleListingRepository(db);
const decreaseRequests = new DrizzleSettlementDecreaseRequestRepository(db);
const pdp = createPdpClient({ baseUrl: "http://127.0.0.1:26592" });

const TENANT = "00000000-0000-4000-8000-0000000f0002";

function ownerPrincipal(id: string): Principal {
  return {
    id,
    roles: ["user", "business_user"],
    attr: { jurisdiction: "ID", businessRoles: { [TENANT]: "owner" }, isSuspended: false },
  };
}

function adminPrincipal(id: string): Principal {
  return {
    id,
    roles: ["user", "business_user"],
    attr: { jurisdiction: "ID", businessRoles: { [TENANT]: "admin" }, isSuspended: false },
  };
}

function controllerFor(principal: Principal): SettlementDecreaseController {
  const principals = { resolve: vi.fn().mockReturnValue(principal) };
  return new SettlementDecreaseController(principals, listings, decreaseRequests, pdp);
}

const request = {} as FastifyRequest;

beforeAll(async () => {
  await clearStoreTables(db);
});

async function seedListing(settlementValueIdr: number) {
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

  return listings.create(TENANT, {
    merchantName: "Settlement Decrease Workflow Test",
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

describe("propose", () => {
  it("records a pending request and applies nothing", async () => {
    const listing = await seedListing(1_000_000);
    const requester = ownerPrincipal(randomUUID());
    const body = proposeSettlementDecreaseSchema.parse({
      proposedSettlementValueIdr: 500_000, // 50% cut, material
      reason: "Big cut.",
    });

    const proposed = await controllerFor(requester).propose(TENANT, listing.id, body, request);
    expect(proposed.state).toBe("pending");
    expect(proposed.requestedBy).toBe(requester.id);

    const unchanged = await listings.findOwnedById(TENANT, listing.id);
    expect(unchanged?.settlementValueIdr).toBe(1_000_000);
  });

  // YT-0576: the non-material case used to be "a 10% cut, below the 20%
  // threshold". With the threshold removed, the ONLY change that is not a
  // decrease is an increase -- so that is what this now sends. A 10% cut
  // belongs to the accepted path and is covered above.
  it("REFUSES an increase -- that path is set_settlement_value, not this one", async () => {
    const listing = await seedListing(1_000_000);
    const requester = ownerPrincipal(randomUUID());
    const body = proposeSettlementDecreaseSchema.parse({
      proposedSettlementValueIdr: 1_100_000,
      reason: "Rate went up, not down.",
    });

    await expect(
      controllerFor(requester).propose(TENANT, listing.id, body, request),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("REFUSES a second proposal while one is already pending", async () => {
    const listing = await seedListing(1_000_000);
    const requester = ownerPrincipal(randomUUID());
    const body = proposeSettlementDecreaseSchema.parse({
      proposedSettlementValueIdr: 500_000,
      reason: "First cut.",
    });
    await controllerFor(requester).propose(TENANT, listing.id, body, request);

    await expect(
      controllerFor(requester).propose(
        TENANT,
        listing.id,
        proposeSettlementDecreaseSchema.parse({
          proposedSettlementValueIdr: 400_000,
          reason: "Second cut.",
        }),
        request,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("approve", () => {
  it("a second person applies the value change", async () => {
    const listing = await seedListing(1_000_000);
    const requester = ownerPrincipal(randomUUID());
    const approver = adminPrincipal(randomUUID());

    const proposed = await controllerFor(requester).propose(
      TENANT,
      listing.id,
      proposeSettlementDecreaseSchema.parse({
        proposedSettlementValueIdr: 500_000,
        reason: "Big cut.",
      }),
      request,
    );

    const approved = await controllerFor(approver).approve(
      TENANT,
      listing.id,
      proposed.id,
      request,
    );
    expect(approved.updated.settlementValueIdr).toBe(500_000);

    const persisted = await listings.findOwnedById(TENANT, listing.id);
    expect(persisted?.settlementValueIdr).toBe(500_000);
  });

  it("SELF-APPROVAL: the requester cannot approve their own request, even against a real PDP decision", async () => {
    const listing = await seedListing(1_000_000);
    const requester = ownerPrincipal(randomUUID());

    const proposed = await controllerFor(requester).propose(
      TENANT,
      listing.id,
      proposeSettlementDecreaseSchema.parse({
        proposedSettlementValueIdr: 500_000,
        reason: "Self-approval attempt.",
      }),
      request,
    );

    // The SAME principal (an owner, who otherwise CAN approve settlement
    // decreases for this tenant) tries to approve the request they raised.
    await expect(
      controllerFor(requester).approve(TENANT, listing.id, proposed.id, request),
    ).rejects.toMatchObject({ status: 403 });

    // Left no trace of having half-happened.
    const unchanged = await listings.findOwnedById(TENANT, listing.id);
    expect(unchanged?.settlementValueIdr).toBe(1_000_000);
  });

  it("a non-owner/admin cannot approve at all", async () => {
    const listing = await seedListing(1_000_000);
    const requester = ownerPrincipal(randomUUID());
    const merchandiser: Principal = {
      id: randomUUID(),
      roles: ["user", "business_user"],
      attr: {
        jurisdiction: "ID",
        businessRoles: { [TENANT]: "merchandiser" },
        isSuspended: false,
      },
    };

    const proposed = await controllerFor(requester).propose(
      TENANT,
      listing.id,
      proposeSettlementDecreaseSchema.parse({
        proposedSettlementValueIdr: 500_000,
        reason: "Big cut.",
      }),
      request,
    );

    await expect(
      controllerFor(merchandiser).approve(TENANT, listing.id, proposed.id, request),
    ).rejects.toMatchObject({ status: 403 });
  });
});
