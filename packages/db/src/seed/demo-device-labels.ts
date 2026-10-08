import type pg from "pg";

/**
 * Past staging checks paired counter devices named after their task ("8.2.e Check …"),
 * and Studio's team screen lists them to reviewers. Gives those a plain label; the
 * device's history and revocation are untouched.
 */
export async function relabelCheckDevices(pool: pg.Pool): Promise<number> {
  const result = await pool.query(
    `UPDATE store.counter_device SET label = 'Counter tablet'
      WHERE label ~ '^[0-9]+\.[0-9]+(\.[a-z])? [Cc]heck'`,
  );
  return result.rowCount ?? 0;
}
