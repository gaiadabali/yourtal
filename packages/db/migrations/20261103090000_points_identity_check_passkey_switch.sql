-- F126/F102: the identity check's second switch, `requirePasskey`, off until
-- finance turns it on (two-person, like `enabled`). Approved rows are frozen,
-- so each region gets one new approved row: its current value plus
-- `requirePasskey: false`, so `enabled` stays whatever it was. A region whose
-- current value already carries the key is skipped. Data only, no DDL.
INSERT INTO platform.region_setting (region, key, value, set_by, approved_by, effective_from)
SELECT region, key, value || '{"requirePasskey": false}'::jsonb, 'migration', 'group-6.11a', now()
  FROM (
    SELECT DISTINCT ON (region) region, key, value
      FROM platform.region_setting
     WHERE key = 'points_identity_check' AND approved_by IS NOT NULL AND effective_from <= now()
     ORDER BY region, effective_from DESC
  ) AS current
 WHERE value -> 'requirePasskey' IS NULL;
