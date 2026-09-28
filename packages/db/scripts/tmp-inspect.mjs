import pg from "pg";
const pool = new pg.Pool({ connectionString: "postgres://yourtal:yourtal_local_only@127.0.0.1:26432/yourtal_s8c" });
const listings = await pool.query(`
  select id, merchant_id, merchant_name, region, currency, price_in_points, stock_remaining, face_value_minor
  from store.listings
  order by region, price_in_points
  limit 40
`);
console.log(JSON.stringify(listings.rows, null, 2));
const aud = await pool.query(`
  select v.id, v.state, v.currency, v.region, v.owner_id, l.merchant_id, l.merchant_name
  from voucher.vouchers v join store.listings l on l.id = v.listing_id
  where v.currency = 'AUD' order by v.state limit 5
`);
console.log("AUD vouchers:", JSON.stringify(aud.rows, null, 2));
await pool.end();
