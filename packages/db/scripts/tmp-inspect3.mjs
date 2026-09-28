import pg from "pg";
const pool = new pg.Pool({ connectionString: "postgres://yourtal:yourtal_local_only@127.0.0.1:26432/yourtal_s8c" });
const r = await pool.query(`select region, count(*) from store.listings group by region`);
console.log(r.rows);
await pool.end();
