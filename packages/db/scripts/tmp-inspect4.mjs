import pg from "pg";
const pool = new pg.Pool({ connectionString: "postgres://yourtal:yourtal_local_only@127.0.0.1:26432/yourtal_s8c" });
const cols = await pool.query(`select column_name, data_type, is_nullable from information_schema.columns where table_schema='store' and table_name='merchant_location' order by ordinal_position`);
console.log(cols.rows);
const sample = await pool.query(`select * from store.merchant_location limit 3`);
console.log(sample.rows);
await pool.end();
