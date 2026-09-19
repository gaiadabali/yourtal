import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { seed } from "./seed";

/**
 * YT-0519, against the real Postgres from `pnpm dev:up`.
 *
 * Two things are being tested and only one of them is the seed. The other is
 * that the catalogue migration's constraints actually hold — the same
 * argument as the ledger tests: `listings_settlement_within_face` is an
 * economic invariant, and "a service will not do that" is not enforcement.
 */

const { Pool } = pg;
const APP_URL = "postgres://yourtal_app:app_local_only@127.0.0.1:26432/yourtal";

let pool: pg.Pool;

beforeAll(async () => {
  pool = new Pool({ connectionString: APP_URL, max: 4 });
  await seed(pool);
});

afterAll(async () => {
  await pool.end();
});

async function count(sql: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(sql);
  return Number(rows[0]?.n ?? "0");
}

describe("the seed", () => {
  it("puts a catalogue in the database", async () => {
    expect(await count("SELECT COUNT(*)::text AS n FROM campaign.campaigns")).toBeGreaterThan(0);
    expect(await count("SELECT COUNT(*)::text AS n FROM store.listings")).toBeGreaterThan(0);
    expect(await count("SELECT COUNT(*)::text AS n FROM voucher.vouchers")).toBeGreaterThan(0);
  });

  it("is idempotent", async () => {
    // Deterministic generators plus ON CONFLICT DO NOTHING. A second run
    // writing rows would mean either the ids move between runs or the
    // catalogue doubles — both make a seeded stack useless to debug against.
    const before = await count("SELECT COUNT(*)::text AS n FROM store.listings");
    const again = await seed(pool);
    const after = await count("SELECT COUNT(*)::text AS n FROM store.listings");

    expect(again).toEqual({ campaigns: 0, listings: 0, vouchers: 0 });
    expect(after).toBe(before);
  });

  it("produces no voucher its listing could not have issued", async () => {
    // The reason the seed rebuilds vouchers rather than inserting what the
    // generator produced. A voucher whose merchant or face value disagrees
    // with its listing is a state no real flow can reach, and a day lost to
    // debugging one is a day lost to nothing.
    const incoherent = await count(`
      SELECT COUNT(*)::text AS n
        FROM voucher.vouchers v
        JOIN store.listings l ON l.id = v.listing_id
       WHERE v.merchant_id <> l.merchant_id
          OR v.face_value_idr <> l.face_value_idr
          OR v.partial_redemption_policy <> l.partial_redemption_policy`);

    expect(incoherent).toBe(0);
  });
});

describe("the catalogue constraints hold in Postgres", () => {
  const listing = (over: Record<string, unknown> = {}) => ({
    id: "00000000-0000-4000-8000-0000000000f1",
    merchant_id: "00000000-0000-4000-8000-0000000000f2",
    merchant_name: "Test Merchant",
    title: "T",
    description: "D",
    category: "food_beverage",
    face_value_idr: 50_000,
    settlement_value_idr: 30_000,
    price_in_points: 5_000,
    stock_remaining: 5,
    stock_total: 10,
    transferable: false,
    partial_redemption_policy: "single_use_forfeit",
    minimum_spend_idr: null,
    expires_at: "2027-01-01T00:00:00Z",
    status: "available",
    ...over,
  });

  async function insertListing(row: Record<string, unknown>): Promise<void> {
    const keys = Object.keys(row);
    const placeholders = keys.map((_key, index) => `$${String(index + 1)}`).join(",");
    await pool.query(
      `INSERT INTO store.listings (${keys.join(",")}) VALUES (${placeholders})`,
      Object.values(row),
    );
  }

  it("REJECTS settlement above face value", async () => {
    // An economic invariant: settlement above face means the platform pays
    // out more than the voucher was ever worth, on every redemption,
    // silently. docs/09 §3.
    await expect(insertListing(listing({ settlement_value_idr: 60_000 }))).rejects.toThrow(
      /listings_settlement_within_face/,
    );
  });

  it("REJECTS stock remaining above the total", async () => {
    await expect(insertListing(listing({ stock_remaining: 11 }))).rejects.toThrow(
      /listings_stock_within_total/,
    );
  });

  it("REJECTS a sold_out listing that still has stock", async () => {
    await expect(
      insertListing(listing({ status: "sold_out", stock_remaining: 3 })),
    ).rejects.toThrow(/listings_sold_out_has_no_stock/);
  });

  it("REJECTS a minimum_spend policy with no threshold", async () => {
    await expect(
      insertListing(listing({ partial_redemption_policy: "minimum_spend" })),
    ).rejects.toThrow(/listings_minimum_spend_iff_policy/);
  });

  it("REJECTS a quick campaign longer than 60 seconds", async () => {
    // campaignSchema's refinement, which JSON Schema could not carry into
    // the OpenAPI document. Re-implemented where it cannot be bypassed.
    await expect(
      pool.query(
        `INSERT INTO campaign.campaigns
           (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
            estimated_data_mb, reward_points, question_count, scoring_rule, status, published_at)
         VALUES ('00000000-0000-4000-8000-0000000000f3','quick','T',
                 '00000000-0000-4000-8000-0000000000f4','M','S',
                 120, 5, 100, 0, 'base_only', 'active', now())`,
      ),
    ).rejects.toThrow(/campaigns_quick_is_short/);
  });

  it("REJECTS an accuracy bonus with no questions to score", async () => {
    await expect(
      pool.query(
        `INSERT INTO campaign.campaigns
           (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
            estimated_data_mb, reward_points, question_count, scoring_rule, status, published_at)
         VALUES ('00000000-0000-4000-8000-0000000000f5','long_form','T',
                 '00000000-0000-4000-8000-0000000000f6','M','S',
                 600, 50, 100, 0, 'base_plus_accuracy_bonus', 'active', now())`,
      ),
    ).rejects.toThrow(/campaigns_bonus_needs_questions/);
  });
});

describe("a voucher's branch must be one its listing offers (YT-0502)", () => {
  it("REJECTS a voucher pointing at a branch of a different listing", async () => {
    // The reason locations are tables rather than a jsonb column. A plain FK
    // to merchant_location would allow a voucher for listing L naming a
    // branch L does not serve — the customer is sent to a shop that has
    // never heard of the offer, and nothing objects. The composite FK makes
    // that unrepresentable.
    // The pair is SELECTED to be mismatched rather than assumed to be.
    // This used to take the first two link rows and assert they had
    // different listings, which held only while no listing happened to own
    // both of the first two rows — a merchant-roster change reordered the
    // catalogue and it failed, having found nothing wrong. The NOT EXISTS is
    // load-bearing too: two listings from one merchant can share a branch,
    // and such a location is one the listing DOES serve, so the constraint
    // would rightly accept it and the test would report a false negative.
    const { rows } = await pool.query<{ listing_id: string; location_id: string }>(
      `SELECT a.listing_id, b.location_id
         FROM store.listing_location a
         JOIN store.listing_location b ON b.listing_id <> a.listing_id
        WHERE NOT EXISTS (
                SELECT 1 FROM store.listing_location c
                 WHERE c.listing_id = a.listing_id
                   AND c.location_id = b.location_id)
        ORDER BY a.listing_id, b.location_id
        LIMIT 1`,
    );
    const pair = rows[0];
    expect(
      pair,
      "the seed should offer at least two listings with distinct branches",
    ).toBeDefined();
    const mine = { listing_id: pair?.listing_id };
    const someoneElses = { location_id: pair?.location_id };

    await expect(
      pool.query(
        `INSERT INTO voucher.vouchers
           (id, listing_id, owner_id, code, merchant_id, merchant_name, title,
            face_value_idr, remaining_value_idr, partial_redemption_policy,
            minimum_spend_idr, transferable, status, issued_at, expires_at, location_id)
         VALUES (gen_random_uuid(), $1, gen_random_uuid(), 'WRONGBRANCH',
                 gen_random_uuid(), 'M', 'T', 1000, 1000, 'single_use_forfeit',
                 NULL, false, 'active', now(), now() + interval '30 days', $2)`,
        [mine?.listing_id, someoneElses?.location_id],
      ),
    ).rejects.toThrow(/vouchers_location_is_offered_by_its_listing/);
  });

  it("accepts a voucher at a branch its own listing offers", async () => {
    const { rows } = await pool.query<{ listing_id: string; location_id: string }>(
      `SELECT listing_id, location_id FROM store.listing_location LIMIT 1`,
    );
    const pair = rows[0];
    const code = `OK${String(Date.now()).slice(-8)}`;

    // Removed again at the end: this row exists to prove the constraint
    // accepts it, and it is deliberately NOT coherent with its listing in
    // the other fields. Leaving it behind would make the seed's own
    // coherence assertion fail on the next run — which it did, once, and
    // the coherence test is right to object.
    await expect(
      pool.query(
        `INSERT INTO voucher.vouchers
           (id, listing_id, owner_id, code, merchant_id, merchant_name, title,
            face_value_idr, remaining_value_idr, partial_redemption_policy,
            minimum_spend_idr, transferable, status, issued_at, expires_at, location_id)
         VALUES (gen_random_uuid(), $1, gen_random_uuid(), $3,
                 gen_random_uuid(), 'M', 'T', 1000, 1000, 'single_use_forfeit',
                 NULL, false, 'active', now(), now() + interval '30 days', $2)`,
        [pair?.listing_id, pair?.location_id, code],
      ),
    ).resolves.toBeDefined();

    await pool.query(`DELETE FROM voucher.vouchers WHERE code = $1`, [code]);
  });

  it("every seeded listing offers at least one branch", async () => {
    // listingSchema says `.min(1)`; a table cannot express "at least one
    // row", so that half of the invariant is asserted here against real data
    // rather than left to Zod alone.
    const orphaned = await count(`
      SELECT COUNT(*)::text AS n FROM store.listings l
       WHERE NOT EXISTS (SELECT 1 FROM store.listing_location ll WHERE ll.listing_id = l.id)`);

    expect(orphaned).toBe(0);
  });
});
