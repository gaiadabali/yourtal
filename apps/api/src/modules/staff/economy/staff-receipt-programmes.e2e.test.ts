import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ReceiptProgrammeRow } from "@yourtal/contracts/staff/economy";
import { AppModule } from "../../../app.module";
import { withAgeBandEnrichment } from "../../../shared/ledger-client/age-band-ledger-client";
import { FakeLedgerClient } from "../../../shared/ledger-client/fake-ledger-client";
import { LEDGER_INTERNAL_CLIENT } from "../../../shared/ledger-client/ledger-internal-client";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import { createAppDb } from "../../../shared/persistence/drizzle-client";
import { sessionFor } from "../../../shared/testing/session-for";
import { partnerKit, receipt } from "../../partners/testing/partner-e2e-kit";
import { grantStaffRole, ownerPool } from "../staff.test-helper";

/**
 * 2.9.c: the staff console's read of SnapApp's receipt programme, over the
 * real HTTP stack (real Postgres, real Cerbos, the FAKE ledger with the
 * receipt draw on). A funder with a package and some receipt grants shows its
 * package left, what it paid and its top earners; a region with no funder is
 * an empty list; only finance and ops may read it.
 */
const ownerDb = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");
const appDb = createAppDb(process.env["DATABASE_URL"] ?? "");

let app: NestFastifyApplication;
let owner: Pool;
let kit: ReturnType<typeof partnerKit>;
/** Set to make the ledger answer with no settings at all: no funder, no `receipt_points`. */
let hideSettings = false;

beforeAll(async () => {
  const fake = withAgeBandEnrichment(new FakeLedgerClient(appDb, { receiptDraw: true }), appDb);
  const ledger: LedgerInternalClient = new Proxy(fake, {
    get(target, property, receiver): unknown {
      if (property === "getSettings") {
        return async (region: "AU" | "ID") =>
          hideSettings ? [] : await target.getSettings(region);
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? (value as () => unknown).bind(target) : value;
    },
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LEDGER_INTERNAL_CLIENT)
    .useValue(ledger)
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    rawBody: true,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  owner = ownerPool();
  kit = partnerKit(app, ownerDb);
});

afterAll(async () => {
  await owner.end();
  await app.close();
});

async function staffWith(role: "finance" | "ops" | "support") {
  const session = await sessionFor(app, { jurisdiction: "AU" });
  await grantStaffRole(owner, session.userId, role);
  return session;
}

function programmes(region: string, cookie: string) {
  return app.inject({
    method: "GET",
    url: `/api/staff/economy/${region}/receipt-programmes`,
    headers: { cookie },
  });
}

describe("GET /api/staff/economy/:region/receipt-programmes", () => {
  it("shows a funder's package left, what it paid and its top earners, and nothing from another region", async () => {
    const partner = await kit.seedPartner();
    const funded = await kit.fundReceipts(partner, "AU");
    const heavy = await kit.linkedAdult(partner);
    const light = await kit.linkedAdult(partner);
    for (const [who, count] of [
      [heavy, 3],
      [light, 1],
    ] as const) {
      for (let i = 0; i < count; i += 1) {
        const paid = await kit.partnerPost(partner, "actions", receipt(who.linkId));
        expect(paid.statusCode, paid.body).toBe(200);
      }
    }
    const finance = await staffWith("finance");
    const mine = async () =>
      (await programmes("AU", finance.cookie))
        .json<ReceiptProgrammeRow[]>()
        .find((candidate) => candidate.partnerId === partner.partnerId);

    const response = await programmes("AU", finance.cookie);
    expect(response.statusCode, response.body).toBe(200);
    const row = response
      .json<ReceiptProgrammeRow[]>()
      .find((candidate) => candidate.partnerId === partner.partnerId);
    expect(row).toMatchObject({
      partnerId: partner.partnerId,
      funderBusinessId: funded.businessId,
      pointsPerReceipt: 1,
      paidPoints: 4,
      paidLast7Days: 4,
      packages: [{ allocationId: funded.allocationId, totalPoints: 1_000, remainingPoints: 996 }],
      topEarners: [
        { userId: heavy.session.userId, points: 3, receipts: 3 },
        { userId: light.session.userId, points: 1, receipts: 1 },
      ],
    });
    expect(row?.funderName).not.toBe("");
    expect(Date.parse(row?.packages[0]?.boughtAt ?? "")).not.toBeNaN();
    // The ledger's id, never an email.
    expect(response.body).not.toContain(heavy.session.email);
    expect(response.body).not.toContain(light.session.email);

    // Another region has no such partner.
    const other = await programmes("ID", finance.cookie);
    expect(other.statusCode).toBe(200);
    expect(
      other
        .json<ReceiptProgrammeRow[]>()
        .some((candidate) => candidate.partnerId === partner.partnerId),
    ).toBe(false);

    // Points older than 7 days leave the week; older than 30 leave the top earners.
    await ownerDb.execute(
      sql`UPDATE platform.ledger_fake_grant SET granted_at = now() - interval '10 days' WHERE user_id = ${light.session.userId}`,
    );
    const aged = await mine();
    expect(aged).toMatchObject({ paidPoints: 4, paidLast7Days: 3 });
    expect(aged?.topEarners).toHaveLength(2);
    await ownerDb.execute(
      sql`UPDATE platform.ledger_fake_grant SET granted_at = now() - interval '40 days' WHERE user_id = ${light.session.userId}`,
    );
    const old = await mine();
    expect(old).toMatchObject({ paidPoints: 4, paidLast7Days: 3 });
    expect(old?.topEarners).toEqual([{ userId: heavy.session.userId, points: 3, receipts: 3 }]);
  });

  it("is an empty list for a region with no receipt funder", async () => {
    const finance = await staffWith("finance");
    hideSettings = true;
    try {
      const response = await programmes("AU", finance.cookie);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual([]);
    } finally {
      hideSettings = false;
    }
  });

  it("is open to finance and ops, and refused to support, a non-staff user and an unknown region", async () => {
    const ops = await staffWith("ops");
    const support = await staffWith("support");
    const plain = await sessionFor(app, { jurisdiction: "AU" });
    expect((await programmes("AU", ops.cookie)).statusCode).toBe(200);
    expect((await programmes("AU", support.cookie)).statusCode).toBe(403);
    expect((await programmes("AU", plain.cookie)).statusCode).toBe(403);
    expect((await programmes("NZ", ops.cookie)).statusCode).toBe(400);
    const anonymous = await app.inject({
      method: "GET",
      url: "/api/staff/economy/AU/receipt-programmes",
    });
    expect([401, 403]).toContain(anonymous.statusCode);
  });
});
