import pg from "pg";
const pool = new pg.Pool({ connectionString: "postgres://yourtal:yourtal_local_only@127.0.0.1:26432/yourtal_s8c" });
await pool.query(`UPDATE store.listings SET partial_redemption_policy = 'balance_carrying' WHERE id IN ('15fe1d4d-6e16-4fbd-8fd8-8758087a67ef','5404573d-72d3-40bc-a4b3-f22516aad43c')`);
const r = await pool.query(`UPDATE voucher.vouchers SET partial_redemption_policy = 'balance_carrying' WHERE listing_id IN ('15fe1d4d-6e16-4fbd-8fd8-8758087a67ef','5404573d-72d3-40bc-a4b3-f22516aad43c') RETURNING id, state, partial_redemption_policy, face_value_minor`);
console.log(r.rows);
await pool.end();
