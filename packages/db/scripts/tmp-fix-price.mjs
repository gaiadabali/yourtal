import pg from "pg";
const pool = new pg.Pool({ connectionString: "postgres://yourtal:yourtal_local_only@127.0.0.1:26432/yourtal_s8c" });
await pool.query(`UPDATE store.listings SET settlement_value_minor = 30 WHERE id = '15fe1d4d-6e16-4fbd-8fd8-8758087a67ef'`);
await pool.query(`UPDATE store.listings SET settlement_value_minor = 600 WHERE id = '5404573d-72d3-40bc-a4b3-f22516aad43c'`);
const r = await pool.query(`SELECT id, face_value_minor, settlement_value_minor, currency FROM store.listings WHERE id IN ('15fe1d4d-6e16-4fbd-8fd8-8758087a67ef','5404573d-72d3-40bc-a4b3-f22516aad43c')`);
console.log(r.rows);
await pool.end();
