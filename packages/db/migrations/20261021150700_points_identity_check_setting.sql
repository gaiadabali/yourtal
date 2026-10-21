-- F126: no earning before the identity check (a verified sign-in email from a
-- permanent address). Production requires it whatever this says; on staging
-- and dev this region setting switches it on, two-person approved like every
-- F12 number. Seeded off so the demo world keeps earning until someone tries
-- it. Data only, no DDL.
INSERT INTO platform.region_setting (region, key, value, set_by, approved_by, effective_from) VALUES
  ('AU', 'points_identity_check', '{"enabled": false}'::jsonb, 'founder', 'plan-f126', now()),
  ('ID', 'points_identity_check', '{"enabled": false}'::jsonb, 'founder', 'plan-f126', now());
