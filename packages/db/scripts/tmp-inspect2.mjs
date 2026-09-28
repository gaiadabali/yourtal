import pg from "pg";
const pool = new pg.Pool({ connectionString: "postgres://yourtal:yourtal_local_only@127.0.0.1:26432/yourtal_s8c" });
const loc = await pool.query(`
  select ll.location_id, l.region, l.merchant_id
  from store.listing_location ll join store.listings l on l.id = ll.listing_id
  order by l.region limit 10`);
console.log("locations:", JSON.stringify(loc.rows, null, 2));
const biz = await pool.query(`select id, region, currency, is_verified from business.business_accounts order by region limit 10`);
console.log("businesses:", JSON.stringify(biz.rows, null, 2));
await pool.end();
