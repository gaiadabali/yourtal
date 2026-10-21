import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { sessionFor } from "../../shared/testing/session-for";
import { seedBusinessMembership } from "../../shared/testing/seed-business-membership";
import { bootPartnerApp, partnerKit } from "../partners/testing/partner-e2e-kit";

/**
 * 2.10.b T5 (F127, docs/27 sections 3.2 and 3.5) over the real HTTP stack: the
 * receipt funder reads its at-cost packages and buys one by card; any other
 * business is refused before a purchase row or checkout exists. Real Cerbos
 * and Postgres, `LEDGER_MODE=fake`, and the simulated driver (it settles a
 * checkout at once). The Stripe webhook path is in stripe-purchase.e2e.test.ts.
 */
let app: NestFastifyApplication;
let kit: ReturnType<typeof partnerKit>;
const db = createAppDb(process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!);
const owner = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");

beforeAll(async () => {
  app = await bootPartnerApp();
  kit = partnerKit(app, owner);
});
afterAll(async () => {
  await app.close();
});

interface PackageView {
  tierKey: string;
  points: number;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  pricing: string;
}
interface ProgrammeView {
  partners: string[];
  pointsPerReceipt: number;
  earning: boolean;
  remainingPoints: number;
  packages: PackageView[];
}

const programmeUrl = (businessId: string) => `/api/${businessId}/studio/billing/receipt-programme`;

function buyReceipts(cookie: string, businessId: string, key = `test-${randomUUID()}`) {
  return app.inject({
    method: "POST",
    url: `/api/${businessId}/studio/billing/purchases`,
    headers: { cookie, "idempotency-key": key },
    payload: { tierKey: "starter", currency: "AUD", programme: "receipts" },
  });
}

function buyOrdinary(cookie: string, businessId: string, key = `test-${randomUUID()}`) {
  return app.inject({
    method: "POST",
    url: `/api/${businessId}/studio/billing/purchases`,
    headers: { cookie, "idempotency-key": key },
    payload: { tierKey: "starter", currency: "AUD" },
  });
}

async function cardPurchases(businessId: string) {
  const { rows } = await db.execute<{ programme: string | null; status: string }>(
    sql`SELECT programme, status FROM payment.card_purchase WHERE business_id = ${businessId}::uuid`,
  );
  return rows;
}

async function plainBusiness() {
  const session = await sessionFor(app, { jurisdiction: "AU" });
  const businessId = await seedBusinessMembership(db, { userId: session.userId, role: "owner" });
  return { cookie: session.cookie, businessId };
}

describe("GET .../billing/receipt-programme", () => {
  it("shows the funder the AU tiers at cost with GST on top, and what is left", async () => {
    const partner = await kit.seedPartner();
    const funder = await kit.fundReceipts(partner, "AU");

    const response = await app.inject({
      method: "GET",
      url: programmeUrl(funder.businessId),
      headers: { cookie: funder.ownerCookie },
    });
    expect(response.statusCode).toBe(200);
    const view = response.json<ProgrammeView>();
    expect(view.partners).toEqual([partner.partnerId]);
    expect(view.pointsPerReceipt).toBe(1);
    expect(view.earning).toBe(true);
    expect(view.remainingPoints).toBe(1_000);
    const starter = view.packages.find((p) => p.tierKey === "starter");
    expect(starter).toMatchObject({
      points: 1_000,
      subtotalMinor: 3_000,
      taxMinor: 300,
      totalMinor: 3_300,
      pricing: "at_cost",
    });
    expect(view.packages.every((p) => p.pricing === "at_cost")).toBe(true);
  });

  it("answers 404 not_a_receipt_funder to any other business", async () => {
    const other = await plainBusiness();
    const response = await app.inject({
      method: "GET",
      url: programmeUrl(other.businessId),
      headers: { cookie: other.cookie },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json<{ code: string }>().code).toBe("not_a_receipt_funder");
  });
});

describe("POST .../billing/purchases with programme receipts", () => {
  it("pays at cost: the allocation and the card purchase both carry receipts", async () => {
    const funder = await kit.fundReceipts(await kit.seedPartner(), "AU");
    const response = await buyReceipts(funder.ownerCookie, funder.businessId);
    expect(response.statusCode).toBe(201);
    const body = response.json<{
      status: string;
      purchase: { programme: string | null; subtotalMinor: number; totalMinor: number };
      allocation: { programme: string | null; totalPoints: number } | null;
    }>();
    expect(body.status).toBe("paid");
    expect(body.purchase).toMatchObject({
      programme: "receipts",
      subtotalMinor: 3_000,
      totalMinor: 3_300,
    });
    expect(body.allocation).toMatchObject({ programme: "receipts", totalPoints: 1_000 });
    expect((await cardPurchases(funder.businessId)).map((r) => r.programme)).toEqual(["receipts"]);

    // The package is in the funder's room: 1,000 from the kit plus this one.
    const view = (
      await app.inject({
        method: "GET",
        url: programmeUrl(funder.businessId),
        headers: { cookie: funder.ownerCookie },
      })
    ).json<ProgrammeView>();
    expect(view.remainingPoints).toBe(2_000);
  });

  it("replays one key to one purchase, and refuses it for another programme", async () => {
    const funder = await kit.fundReceipts(await kit.seedPartner(), "AU");
    const key = `test-${randomUUID()}`;
    const first = await buyReceipts(funder.ownerCookie, funder.businessId, key);
    const again = await buyReceipts(funder.ownerCookie, funder.businessId, key);
    expect(again.statusCode).toBe(201);
    expect(again.json<{ purchaseId: string }>().purchaseId).toBe(
      first.json<{ purchaseId: string }>().purchaseId,
    );
    expect(await cardPurchases(funder.businessId)).toHaveLength(1);

    const ordinary = await buyOrdinary(funder.ownerCookie, funder.businessId, key);
    expect(ordinary.statusCode).toBe(409);
    expect(ordinary.json<{ code: string }>().code).toBe("idempotency_conflict");
  });

  it("refuses a business that is not the funder, leaving no purchase row", async () => {
    const other = await plainBusiness();
    const response = await buyReceipts(other.cookie, other.businessId);
    expect(response.statusCode).toBe(404);
    expect(response.json<{ code: string }>().code).toBe("not_a_receipt_funder");
    expect(await cardPurchases(other.businessId)).toEqual([]);
  });

  it("leaves receipt packages out of the balance totals", async () => {
    const funder = await kit.fundReceipts(await kit.seedPartner(), "AU");
    await buyReceipts(funder.ownerCookie, funder.businessId);
    const balance = async () =>
      (
        await app.inject({
          method: "GET",
          url: `/api/${funder.businessId}/studio/billing/balance`,
          headers: { cookie: funder.ownerCookie },
        })
      ).json<{
        totalPoints: number;
        remainingPoints: number;
        allocations: { programme: string | null }[];
      }>();

    const before = await balance();
    expect(before).toMatchObject({ totalPoints: 0, remainingPoints: 0 });
    expect(before.allocations.filter((a) => a.programme === "receipts")).toHaveLength(2);

    expect((await buyOrdinary(funder.ownerCookie, funder.businessId)).statusCode).toBe(201);
    expect(await balance()).toMatchObject({ totalPoints: 1_000, remainingPoints: 1_000 });
  });
});
