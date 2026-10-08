import type pg from "pg";

/**
 * A business that sells vouchers in the store is a supplier, and Studio's
 * Inventory zone is only shown to suppliers. The demo brands were seeded as
 * advertiser + redeemer only, so no demo login could open Inventory. Adds the
 * role to every verified business that owns a listing and lacks it.
 */
export async function ensureDemoSuppliers(pool: pg.Pool): Promise<number> {
  const result = await pool.query(
    `UPDATE business.business_accounts b
        SET roles = b.roles || '["supplier"]'::jsonb
      WHERE b.is_verified
        AND NOT (b.roles ? 'supplier')
        AND EXISTS (SELECT 1 FROM store.listings l WHERE l.merchant_id = b.id)`,
  );
  return result.rowCount ?? 0;
}
