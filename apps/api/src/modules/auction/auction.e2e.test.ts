import { createHash, randomBytes, randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { ZodValidationPipe } from "nestjs-zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { AppModule } from "../../app.module";

/**
 * 13.22 over real HTTP, a real PDP and the fake voucher engine: list into
 * escrow, refused bidders, racing bids, the close paying the charity's own
 * account, the voucher to the winner, every other hold released, receipts.
 */
const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!;
let app: NestFastifyApplication;
let pool: pg.Pool;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useGlobalPipes(new ZodValidationPipe());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

const ip = (): string => `10.${[...randomBytes(3)].join(".")}`;

interface Person {
  readonly userId: string;
  readonly token: string;
}

async function person(region: "AU" | "ID", teen = false): Promise<Person> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    remoteAddress: ip(),
    headers: { "idempotency-key": randomUUID() },
    payload: {
      email: `auction-${randomUUID()}@example.test`,
      password: `auction-test-${randomUUID()}`,
      region,
      locale: region === "AU" ? "en-AU" : "id-ID",
      displayName: "Bidder",
      dateOfBirth: "1990-01-01",
      timezone: region === "AU" ? "Australia/Sydney" : "Asia/Jakarta",
    },
  });
  expect(response.statusCode, response.body).toBeLessThan(300);
  const { userId, token } = response.json<{ userId: string; token: string }>();
  await pool.query(`UPDATE identity.credential SET verified_at = now() WHERE user_id = $1`, [
    userId,
  ]);
  if (teen) {
    await pool.query(
      `UPDATE identity.user_profile SET date_of_birth = (now() - interval '15 years')::date,
              parent_consent_status = 'granted' WHERE user_id = $1`,
      [userId],
    );
  }
  return { userId, token };
}

async function charity(adminId: string): Promise<{ id: string; payout: string }> {
  const id = randomUUID();
  const payout = `simpayout_${randomUUID().slice(0, 8)}`;
  await pool.query(
    `INSERT INTO charity.charity (id, region, name, cause, summary, registration,
       payout_account_name, payout_account_last4, kyb_reference, payout_reference, state,
       applied_by, decided_by, decided_at)
     VALUES ($1, 'ID', 'Yayasan Uji', 'education', 'e2e', $2, 'Yayasan Uji', '1234', 'simkyb',
             $3, 'approved', $4, 'staff', now())`,
    [
      id,
      JSON.stringify({ kind: "id_yayasan", deedNumber: "AHU-1", fundraisingPermitNumber: "PUB-1" }),
      payout,
      adminId,
    ],
  );
  await pool.query(`INSERT INTO charity.member (charity_id, user_id) VALUES ($1, $2)`, [
    id,
    adminId,
  ]);
  return { id, payout };
}

async function voucherFor(ownerId: string): Promise<string> {
  const listingId = randomUUID();
  await pool.query(
    `INSERT INTO store.listings (id, merchant_id, merchant_name, title, description, category,
       face_value_minor, settlement_value_minor, price_in_points, stock_remaining, stock_total,
       transferable, partial_redemption_policy, minimum_spend_minor, expires_at, status, currency,
       region, audience, content_category, image_url, channel, partial_redemption)
     VALUES ($1, $2, 'Kopi', 'Kopi voucher', 'e2e', 'food_beverage', 50000, 15000, 1000, 10, 10,
       true, 'single_use_forfeit', NULL, now() + interval '90 days', 'available', 'IDR', 'ID',
       'all_ages', 'food-and-drink', 'http://127.0.0.1:26900/p.jpg', 'both', 'single_use')`,
    [listingId, randomUUID()],
  );
  const voucherId = randomUUID();
  const code = randomUUID().replace(/-/g, "").slice(0, 16);
  await pool.query(
    `INSERT INTO platform.voucher_fake_voucher
       (id, listing_id, saga_id, owner_id, code, code_hash, state, remaining_value_minor, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'activated', 50000, now() + interval '90 days')`,
    [
      voucherId,
      listingId,
      randomUUID(),
      ownerId,
      code,
      createHash("sha256").update(code).digest("hex"),
    ],
  );
  return voucherId;
}

const call = (method: "GET" | "POST", url: string, who: Person, payload?: object) =>
  app.inject({
    method,
    url,
    headers: {
      authorization: `Bearer ${who.token}`,
      ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}),
    },
    ...(payload === undefined ? {} : { payload }),
  });

describe("13.22 — charity auctions", () => {
  it("lists into escrow, takes one bid at a time, and pays the charity at the close", async () => {
    const [seller, a, b, teen, abroad, admin] = [
      await person("ID"),
      await person("ID"),
      await person("ID"),
      await person("ID", true),
      await person("AU"),
      await person("ID"),
    ];
    const { id: charityId, payout } = await charity(admin.userId);
    const voucherId = await voucherFor(seller.userId);

    const listed = await call("POST", `/api/wallet/vouchers/${voucherId}/auction`, seller, {
      charityId,
    });
    expect(listed.statusCode, listed.body).toBe(201);
    const auction = listed.json<{
      auctionId: string;
      reserveMinor: number;
      minimumNextBidMinor: number;
    }>();
    expect(auction).toMatchObject({ reserveMinor: 25000, minimumNextBidMinor: 25000, bidCount: 0 });
    const { rows: old } = await pool.query(
      `SELECT void_reason FROM platform.voucher_fake_voucher WHERE id = $1`,
      [voucherId],
    );
    expect(old[0]?.void_reason).toBe("transfer");

    const url = `/api/auctions/${auction.auctionId}`;
    expect((await call("POST", `${url}/bids`, teen, { amountMinor: 30000 })).statusCode).toBe(403);
    expect((await call("POST", `${url}/bids`, abroad, { amountMinor: 30000 })).statusCode).toBe(
      403,
    );
    expect((await call("POST", `${url}/bids`, seller, { amountMinor: 30000 })).statusCode).toBe(
      403,
    );
    expect((await call("POST", `${url}/bids`, a, { amountMinor: 20000 })).json()).toMatchObject({
      code: "bid_too_low",
    });

    // Two bidders racing at the same amount: one leads, the other must go higher.
    const [ra, rb] = await Promise.all([
      call("POST", `${url}/bids`, a, { amountMinor: 30000 }),
      call("POST", `${url}/bids`, b, { amountMinor: 30000 }),
    ]);
    expect([ra.statusCode, rb.statusCode].sort()).toEqual([201, 409]);
    const loser = ra.statusCode === 409 ? a : b;
    const raised = await call("POST", `${url}/bids`, loser, { amountMinor: 32000 });
    expect(raised.statusCode, raised.body).toBe(201);
    expect(raised.json()).toMatchObject({
      bidCount: 2,
      currentAmountMinor: 32000,
      viewer: { bidStatus: "leading" },
    });
    expect(JSON.stringify(raised.json())).not.toContain(a.userId);
    expect(JSON.stringify(raised.json())).not.toContain(b.userId);

    await pool.query(
      `UPDATE auction.auction SET ends_at = now() - interval '1 second' WHERE id = $1`,
      [auction.auctionId],
    );
    const closed = await call("GET", url, loser);
    expect(closed.json()).toMatchObject({
      state: "ended",
      outcome: "sold",
      viewer: { bidStatus: "won" },
    });

    const {
      rows: [settlement],
    } = await pool.query(`SELECT * FROM auction.settlement WHERE auction_id = $1`, [
      auction.auctionId,
    ]);
    expect(settlement).toMatchObject({
      outcome: "sold",
      winner_id: loser.userId,
      amount_minor: "32000",
      destination_reference: payout,
    });
    const { rows: bids } = await pool.query<{ state: string }>(
      `SELECT state FROM auction.bid WHERE auction_id = $1 ORDER BY amount_minor`,
      [auction.auctionId],
    );
    expect(bids.map((bid) => bid.state)).toEqual(["released", "captured"]);
    const { rows: escrow } = await pool.query(
      `SELECT v.owner_id FROM platform.voucher_fake_escrow e JOIN platform.voucher_fake_voucher v ON v.id = e.voucher_id WHERE e.auction_id = $1`,
      [auction.auctionId],
    );
    expect(escrow[0]?.owner_id).toBe(loser.userId);
    const { rows: receipts } = await pool.query<{ party: string }>(
      `SELECT party FROM auction.receipt WHERE auction_id = $1 ORDER BY party`,
      [auction.auctionId],
    );
    expect(receipts.map((r) => r.party)).toEqual(["charity", "seller", "winner"]);
  });

  it("gives an auction nobody bid on to the charity", async () => {
    const [seller, admin] = [await person("ID"), await person("ID")];
    const { id: charityId } = await charity(admin.userId);
    const voucherId = await voucherFor(seller.userId);
    const listed = await call("POST", `/api/wallet/vouchers/${voucherId}/auction`, seller, {
      charityId,
    });
    const { auctionId } = listed.json<{ auctionId: string }>();
    await pool.query(
      `UPDATE auction.auction SET ends_at = now() - interval '1 second' WHERE id = $1`,
      [auctionId],
    );
    expect((await call("GET", `/api/auctions/${auctionId}`, seller)).json()).toMatchObject({
      outcome: "unsold",
    });
    const { rows } = await pool.query(
      `SELECT voucher_owner_id FROM auction.settlement WHERE auction_id = $1`,
      [auctionId],
    );
    expect(rows[0]?.voucher_owner_id).toBe(admin.userId);
  });
});
