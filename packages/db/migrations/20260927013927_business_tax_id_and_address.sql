-- TASKS.md 7.1.a: a region-specific tax ID (ABN for AU; NIB or NPWP for ID)
-- and address (AU: state + postcode; ID: city), replacing the free-text
-- `district` that carried no region behind it
-- (docs/audit/2026-09-25/business-merchant.md's own recommendation).
--
-- Nullable columns first, then a backfill, then NOT NULL + the CHECKs that
-- tie shape to region -- so this applies cleanly against any database that
-- already has business_accounts rows (dev/seed), not only an empty one.

ALTER TABLE business.business_accounts
  ADD COLUMN tax_id_kind text,
  ADD COLUMN tax_id_value text,
  ADD COLUMN address_state text,
  ADD COLUMN address_postcode text,
  ADD COLUMN address_city text;

UPDATE business.business_accounts SET
  tax_id_kind = CASE WHEN region = 'AU' THEN 'ABN' ELSE 'NPWP' END,
  tax_id_value = CASE WHEN region = 'AU' THEN '00000000000' ELSE '000000000000000' END,
  address_state = CASE WHEN region = 'AU' THEN 'NSW' ELSE NULL END,
  address_postcode = CASE WHEN region = 'AU' THEN '2000' ELSE NULL END,
  address_city = CASE WHEN region = 'ID' THEN 'Jakarta' ELSE NULL END
WHERE tax_id_kind IS NULL;

ALTER TABLE business.business_accounts
  ALTER COLUMN tax_id_kind SET NOT NULL,
  ALTER COLUMN tax_id_value SET NOT NULL,
  DROP COLUMN district;

ALTER TABLE business.business_accounts
  ADD CONSTRAINT business_accounts_tax_id_matches_region CHECK (
    (region = 'AU' AND tax_id_kind = 'ABN') OR
    (region = 'ID' AND tax_id_kind IN ('NIB', 'NPWP'))
  ),
  ADD CONSTRAINT business_accounts_address_matches_region CHECK (
    (region = 'AU' AND address_state IS NOT NULL AND address_postcode IS NOT NULL AND address_city IS NULL) OR
    (region = 'ID' AND address_city IS NOT NULL AND address_state IS NULL AND address_postcode IS NULL)
  );
