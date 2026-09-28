import pg from "pg";
import { randomUUID } from "node:crypto";

const pool = new pg.Pool({
  connectionString: "postgres://yourtal:yourtal_local_only@127.0.0.1:26432/yourtal_s8c",
});

async function insertListing({ id, merchantId, merchantName, region, currency, priceInPoints, faceValueMinor, locationId }) {
  await pool.query(
    `INSERT INTO store.listings
       (id, merchant_id, merchant_name, title, description, category,
        face_value_minor, settlement_value_minor, price_in_points,
        stock_remaining, stock_total, transferable, partial_redemption_policy,
        minimum_spend_minor, expires_at, status, currency, region, audience,
        content_category, image_url, channel, partial_redemption)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
    [
      id, merchantId, merchantName, "8.3.d/8.4.b e2e fixture", "a listing minted for Phase 8 C's e2e checks",
      "food-and-drink", faceValueMinor, Math.floor(faceValueMinor / 2), priceInPoints,
      3, 3, false, "single_use_forfeit", null,
      new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(), "available", currency, region, "all_ages",
      "food-and-drink", "http://127.0.0.1:26900/yourtal-media/listings/placeholder.jpg", "both", "single_use",
    ],
  );
  await pool.query(`INSERT INTO store.listing_location (listing_id, location_id) VALUES ($1, $2)`, [id, locationId]);
  return { listingId: id, locationId };
}

const auListingId = randomUUID();
const idListingId = randomUUID();
const auLocationId = randomUUID();

await pool.query(
  `INSERT INTO store.merchant_location (id, merchant_id, name, address, district) VALUES ($1,$2,$3,$4,$5)`,
  [auLocationId, "00000000-0000-4000-8000-000000000603", "e2e AU fixture branch", "1 Example St, Sydney", "Sydney"],
);

const au = await insertListing({
  id: auListingId, merchantId: "00000000-0000-4000-8000-000000000603", merchantName: "e2e AU fixture merchant",
  region: "AU", currency: "AUD", priceInPoints: 50, faceValueMinor: 2000, locationId: auLocationId,
});
const id = await insertListing({
  id: idListingId, merchantId: "00000000-0000-4000-8000-000000000601", merchantName: "e2e ID fixture merchant",
  region: "ID", currency: "IDR", priceInPoints: 50, faceValueMinor: 20000, locationId: "52702891-b8df-44a1-ae56-0680849ce50f",
});

console.log(JSON.stringify({ au, id }, null, 2));
await pool.end();
