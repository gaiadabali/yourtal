-- Group plan 2.10.a, founder decision F119 (docs/16 § V): receipt points drop
-- from 10 to 1 per receipt in AU. ID is a demo; it keeps the old 1:10 ratio
-- (100 becomes 10). F12 and F101 stay as the historical rows they are.
--
-- platform.region_setting is append-only with approval, so the old seed
-- (20260925193000) is not edited: these decided rows are newer, and
-- platform.ledger_setting (newest approved row with effective_from <= now())
-- picks them up.
INSERT INTO platform.region_setting (region, key, value, set_by, approved_by, effective_from) VALUES
  ('AU', 'receipt_points', '1'::jsonb,  'founder', 'group-0.10a', now()),
  ('ID', 'receipt_points', '10'::jsonb, 'founder', 'group-0.10a', now());
