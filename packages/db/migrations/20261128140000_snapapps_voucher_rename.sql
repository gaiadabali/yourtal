-- Owner decision of 2026-11-27: the product is spelled "SnapApps". Renames the
-- seeded demo voucher listing (and its online location) that staging already
-- holds under the old spelling. Data only, no schema change.
--
-- Idempotent and narrow: each UPDATE is keyed on the seed's fixed ids
-- (packages/db/src/seed/demo-snapapp-scans.ts) AND on the old value being
-- present, so a rerun, a listing staff renamed, or an environment without the
-- demo rows changes nothing. Rollback: the same UPDATEs with the values swapped.
UPDATE store.listings
   SET title = '50 SnapApps scans'
 WHERE id = '00000000-0000-4000-9000-000000000401'
   AND title = '50 SnapApp scans';

UPDATE store.listings
   SET description = 'Adds 50 receipt scans to SnapApps. Link SnapApps under Me → Linked apps, then in SnapApps open Points, choose Use a YourTal voucher and enter the code. Only the SnapApps account linked to this YourTal account can use it. Single use.'
 WHERE id = '00000000-0000-4000-9000-000000000401'
   AND description = 'Adds 50 receipt scans to SnapApp. Link SnapApp under Me → Linked apps, then in SnapApp open Points, choose Use a YourTal voucher and enter the code. Only the SnapApp account linked to this YourTal account can use it. Single use.';

UPDATE store.merchant_location
   SET name = 'SnapApps (online)'
 WHERE id = '00000000-0000-4000-9000-000000000402'
   AND name = 'SnapApp (online)';
