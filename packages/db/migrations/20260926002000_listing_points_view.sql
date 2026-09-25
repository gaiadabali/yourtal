-- 4.9.a: apps/api reads a listing's points price and nothing else. The view
-- runs with its owner's rights (security_invoker off), so yourtal_app, which
-- has no USAGE on the ledger schema, sees points but never S, B or rate ids.
CREATE VIEW platform.listing_points WITH (security_invoker = false, security_barrier = true) AS
  SELECT listing_id, price_points AS points, region, currency
  FROM ledger.listing_price;

REVOKE ALL ON platform.listing_points FROM PUBLIC;
GRANT SELECT ON platform.listing_points TO yourtal_app;
