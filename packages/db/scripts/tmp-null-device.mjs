import pg from "pg";
const pool = new pg.Pool({ connectionString: "postgres://yourtal:yourtal_local_only@127.0.0.1:26432/yourtal_s8c" });
const r = await pool.query(`UPDATE voucher.merchant_credential SET device_id = NULL WHERE key_id = $1 RETURNING key_id, device_id`, [process.argv[2]]);
console.log(r.rows);
await pool.end();
