import { createHmac, randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import { ZodValidationPipe } from "nestjs-zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toPoints } from "@yourtal/contracts/money";
import { AppModule } from "../../app.module";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { FakeLedgerClient } from "../../shared/ledger-client/fake-ledger-client";
import { withAgeBandEnrichment } from "../../shared/ledger-client/age-band-ledger-client";
import { LEDGER_INTERNAL_CLIENT } from "../../shared/ledger-client/ledger-internal-client";
import type { LedgerInternalClient } from "../../shared/ledger-client/ledger-internal-client";
import { partnerKit, receipt } from "./testing/partner-e2e-kit";

/**
 * 2.10.b T4 (F127, docs/27 section 3.3-3.4): a partner's receipts are paid from
 * the receipt package its funder bought, and the status read says whether that
 * package is still paying. Run against the FAKE ledger with the receipt draw
 * on (`receiptDraw: true`), whatever the fake's default is until T2b flips it.
 */
const owner = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");
const appDb = createAppDb(process.env["DATABASE_URL"] ?? "");

let app: NestFastifyApplication;
let kit: ReturnType<typeof partnerKit>;
let ledger: LedgerInternalClient;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LEDGER_INTERNAL_CLIENT)
    .useValue(withAgeBandEnrichment(new FakeLedgerClient(appDb, { receiptDraw: true }), appDb))
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    rawBody: true,
  });
  // As main.ts does: the test harness does not add it, and the bad-region case needs it.
  app.useGlobalPipes(new ZodValidationPipe());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  ledger = app.get<LedgerInternalClient>(LEDGER_INTERNAL_CLIENT);
  kit = partnerKit(app, owner);
});

afterAll(async () => {
  await app.close();
});

const PAUSED = "receipt points are paused: the receipt package is used up";

describe("a partner's receipts and the receipt package (F127)", () => {
  it("pays from the package, pauses when it is spent, keeps duplicates, and resumes on a new package", async () => {
    const partner = await kit.seedPartner();
    const funded = await kit.fundReceipts(partner, "AU");
    // A 1,000-point package would take 1,000 receipts to spend; leave it two
    // points. The funder is this test's own business, so nothing else moves.
    await owner.execute(
      sql`UPDATE platform.ledger_fake_allocation SET remaining_points = 2 WHERE id = ${funded.allocationId}`,
    );
    const remaining = async () =>
      (await ledger.getAllocation(funded.allocationId))._unsafeUnwrap().remainingPoints;
    const status = async () => {
      const response = await kit.partnerPost(partner, "receipts/status", { region: "AU" });
      expect(response.statusCode, response.body).toBe(200);
      return response.json<{
        region: string;
        earning: boolean;
        pointsPerReceipt: number;
        remainingPoints: number;
      }>();
    };

    expect(await status()).toEqual({
      region: "AU",
      earning: true,
      pointsPerReceipt: 1,
      remainingPoints: 2,
    });

    const { session, linkId } = await kit.linkedAdult(partner);

    // A receipt is paid from the package, which ends one point lower.
    const first = receipt(linkId);
    const paid = await kit.partnerPost(partner, "actions", first);
    expect(paid.statusCode, paid.body).toBe(200);
    expect(paid.json()).toEqual({ granted: true, points: 1, linkId, duplicate: false });
    expect(await remaining()).toBe(1);
    expect(await kit.availablePoints(session.cookie)).toBe(1);
    expect(await status()).toMatchObject({ earning: true, remainingPoints: 1 });

    // The last point goes; the read now says paused.
    const second = await kit.partnerPost(partner, "actions", receipt(linkId));
    expect(second.json()).toMatchObject({ granted: true, duplicate: false });
    expect(await remaining()).toBe(0);
    expect(await status()).toEqual({
      region: "AU",
      earning: false,
      pointsPerReceipt: 1,
      remainingPoints: 0,
    });

    // Spent: 409 with the fixed message, the wallet unchanged, no id in it.
    const pausedReceipt = receipt(linkId);
    const refused = await kit.partnerPost(partner, "actions", pausedReceipt);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toEqual({ code: "allocation_exhausted", message: PAUSED, linkId });
    expect(refused.body).not.toContain(funded.businessId);
    expect(refused.body).not.toContain(funded.allocationId);
    expect(await kit.availablePoints(session.cookie)).toBe(2);

    // A receipt already paid stays a duplicate after the package is spent.
    const duplicate = await kit.partnerPost(partner, "actions", first);
    expect(duplicate.statusCode, duplicate.body).toBe(200);
    expect(duplicate.json()).toEqual({ granted: true, points: 1, linkId, duplicate: true });
    expect(await kit.availablePoints(session.cookie)).toBe(2);

    // ... and one first reported for another user pays that other user nothing.
    const other = await kit.linkedAdult(partner);
    const stolen = await kit.partnerPost(partner, "actions", { ...first, linkId: other.linkId });
    expect(stolen.statusCode, stolen.body).toBe(200);
    expect(stolen.json()).toEqual({
      granted: false,
      points: 0,
      linkId: other.linkId,
      duplicate: true,
    });
    expect(await kit.availablePoints(other.session.cookie)).toBe(0);

    // A new package ends the pause.
    const quote = (
      await ledger.quotePackage({
        region: "AU",
        tierKey: "starter",
        programme: "receipts",
        businessId: funded.businessId,
      })
    )._unsafeUnwrap();
    const bought = await ledger.purchasePoints({
      businessId: funded.businessId,
      region: "AU",
      currency: quote.currency,
      points: toPoints(quote.points),
      paidMinor: quote.totalMinor,
      idempotencyKey: randomUUID(),
      tierKey: "starter",
      programme: "receipts",
    });
    expect(bought.isOk()).toBe(true);
    expect(await status()).toEqual({
      region: "AU",
      earning: true,
      pointsPerReceipt: 1,
      remainingPoints: quote.points,
    });

    // A NEW receipt pays.
    const fresh = await kit.partnerPost(partner, "actions", receipt(linkId));
    expect(fresh.json()).toEqual({ granted: true, points: 1, linkId, duplicate: false });
    expect(await kit.availablePoints(session.cookie)).toBe(3);

    // F127: the receipt refused while paused was recorded but not paid. Reported
    // again (under a new key) it pays ONCE, as `duplicate: true`, and never twice.
    const repaid = await kit.partnerPost(partner, "actions", pausedReceipt);
    expect(repaid.statusCode, repaid.body).toBe(200);
    expect(repaid.json()).toEqual({ granted: true, points: 1, linkId, duplicate: true });
    expect(await kit.availablePoints(session.cookie)).toBe(4);
    const again = await kit.partnerPost(partner, "actions", pausedReceipt);
    expect(again.json()).toEqual({ granted: true, points: 1, linkId, duplicate: true });
    expect(await kit.availablePoints(session.cookie)).toBe(4);
  });

  it("says a partner with no funder is not earning, and what a receipt would pay", async () => {
    const partner = await kit.seedPartner();
    const au = await kit.partnerPost(partner, "receipts/status", { region: "AU" });
    expect(au.statusCode, au.body).toBe(200);
    expect(au.json()).toEqual({
      region: "AU",
      earning: false,
      pointsPerReceipt: 1,
      remainingPoints: 0,
    });
    const id = await kit.partnerPost(partner, "receipts/status", { region: "ID" });
    expect(id.json()).toEqual({
      region: "ID",
      earning: false,
      pointsPerReceipt: 10,
      remainingPoints: 0,
    });
    const { linkId } = await kit.linkedAdult(partner);
    const refused = await kit.partnerPost(partner, "actions", receipt(linkId));
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ code: string; message: string }>()).toMatchObject({
      code: "allocation_exhausted",
      message: PAUSED,
    });
  });

  it("refuses a bad signature and a bad region", async () => {
    const partner = await kit.seedPartner();
    const unsigned = await kit.partnerPost(partner, "receipts/status", { region: "AU" }, "wrong");
    expect(unsigned.statusCode).toBe(401);
    const bad = await kit.partnerPost(partner, "receipts/status", { region: "NZ" });
    expect(bad.statusCode).toBe(400);
  });

  it("answers 200 with or without an Idempotency-Key header (a read; the key is ignored)", async () => {
    const partner = await kit.seedPartner();
    const raw = JSON.stringify({ region: "AU" });
    const signature = createHmac("sha256", partner.secret).update(raw, "utf8").digest("hex");
    const headers = {
      authorization: `Partner ${partner.partnerId}:${signature}`,
      "content-type": "application/json",
    };
    const key = randomUUID();
    for (const extra of [{ "idempotency-key": key }, { "idempotency-key": key }, {}]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/partners/receipts/status",
        headers: { ...headers, ...extra },
        payload: raw,
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({ region: "AU", earning: false });
    }
  });
});
