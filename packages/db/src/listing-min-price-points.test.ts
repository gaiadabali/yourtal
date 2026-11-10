import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { OWNER_URL } from "./database-urls";

/**
 * 2.8.g: `store.listings.min_price_points` and the `listing_price` proposal
 * kind (migration 20261111090000_listing_min_price_points.sql). Written as the
 * owner, like the other constraint suites, and every refusal has an accepted
 * twin so a CHECK that refused everything cannot pass.
 */

const RUN = Date.now();
let owner: pg.Pool;
let next = 0;

function listingId(): string {
  next += 1;
  return `00000000-0000-4000-8000-${String(28_700_000_000 + next).padStart(12, "0")}`;
}

async function insertListing(id: string, minPricePoints: number | null): Promise<void> {
  await owner.query(
    `INSERT INTO store.listings (id, merchant_id, merchant_name, title, description, category,
       currency, face_value_minor, settlement_value_minor, price_in_points, stock_remaining,
       stock_total, transferable, partial_redemption_policy, minimum_spend_minor, expires_at,
       status, region, audience, content_category, image_url, channel, partial_redemption,
       min_price_points)
     VALUES ($1, '00000000-0000-4000-8000-0000000028f7', 'Probe merchant', 'Probe 2.8.g',
       'Probe', 'food_beverage', 'AUD', 500, 500, 167, 5, 10, false, 'single_use_forfeit', NULL,
       '2027-12-31T00:00:00Z', 'available', 'AU', 'all_ages', 'food-and-drink',
       'https://cdn.example.com/probe.jpg', 'online', 'single_use', $2)`,
    [id, minPricePoints],
  );
}

async function propose(listing: string): Promise<string> {
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO staff.economy_proposal (kind, region, summary, payload, proposed_by)
     VALUES ('listing_price', 'AU', 'probe', $1, $2) RETURNING id`,
    [JSON.stringify({ listingId: listing, minPricePoints: 200 }), `probe-${String(RUN)}`],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("no proposal row");
  return id;
}

async function clear(): Promise<void> {
  await owner.query(`DELETE FROM staff.economy_proposal WHERE proposed_by = $1`, [
    `probe-${String(RUN)}`,
  ]);
  await owner.query(`DELETE FROM store.listings WHERE title = 'Probe 2.8.g'`);
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: OWNER_URL, max: 2 });
  await clear();
});

afterAll(async () => {
  await clear();
  await owner.end();
});

describe("store.listings.min_price_points", () => {
  it("is a nullable bigint, NULL on every listing that existed before", async () => {
    const column = await owner.query(
      `SELECT data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'store' AND table_name = 'listings' AND column_name = 'min_price_points'`,
    );
    expect(column.rows).toEqual([{ data_type: "bigint", is_nullable: "YES" }]);
    await insertListing(listingId(), null);
  });

  it("ACCEPTS a positive price and REFUSES zero or a negative one", async () => {
    await insertListing(listingId(), 200);
    await expect(insertListing(listingId(), 0)).rejects.toThrow(
      /listings_min_price_points_positive/,
    );
    await expect(insertListing(listingId(), -5)).rejects.toThrow(
      /listings_min_price_points_positive/,
    );
  });
});

describe("staff.economy_proposal kind 'listing_price'", () => {
  it("is accepted, with one pending proposal per listing", async () => {
    const listing = listingId();
    const first = await propose(listing);
    await expect(propose(listing)).rejects.toThrow(/economy_proposal_one_pending_listing_price/);

    // Once decided, a new one may be opened.
    await owner.query(
      `UPDATE staff.economy_proposal SET status = 'rejected', decided_at = now() WHERE id = $1`,
      [first],
    );
    await propose(listing);
  });
});
