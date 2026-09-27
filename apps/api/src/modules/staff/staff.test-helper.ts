import { Pool } from "pg";
import type { StaffRole } from "@yourtal/contracts/staff/session";

/**
 * Owner connection for staff tests: `identity.staff_role` is written only by
 * `pnpm staff:add` in real life, never by the app role, so a test grants
 * roles the same way that CLI does.
 */
export function ownerPool(): Pool {
  const url = process.env["DATABASE_OWNER_URL"];
  if (url === undefined || url === "") throw new Error("DATABASE_OWNER_URL is not set");
  return new Pool({ connectionString: url });
}

export async function grantStaffRole(pool: Pool, userId: string, role: StaffRole): Promise<void> {
  await pool.query(
    `INSERT INTO identity.staff_role (user_id, role, granted_by) VALUES ($1, $2, 'test')
     ON CONFLICT DO NOTHING`,
    [userId, role],
  );
}

export async function suspendAccount(pool: Pool, userId: string): Promise<void> {
  await pool.query(`UPDATE identity.user_profile SET suspended_at = now() WHERE user_id = $1`, [
    userId,
  ]);
}
