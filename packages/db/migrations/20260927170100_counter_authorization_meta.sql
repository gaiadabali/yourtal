-- TASKS.md 8.2.b: `authorizeAsDevice` (services/voucher) knows nothing of a
-- cashier's order reference or basket total -- device_routes.go's own
-- comment says its request shape "carries no order reference" by design.
-- The BFF's own authorize/capture split still needs both for the receipt
-- and for Studio -> Redemptions, so this table carries them from the
-- authorize call to the matching capture call, purely BFF-side bookkeeping
-- that never crosses into the voucher service's own ledger of what
-- happened. Deleted once captured (or left for a cleanup job to expire
-- alongside the 5-minute hold it shadows -- 8.2 does not add one yet).

CREATE TABLE store.counter_authorization_meta (
  authorization_id  text        PRIMARY KEY,
  device_id         uuid        NOT NULL REFERENCES store.counter_device (id),
  business_id       uuid        NOT NULL,
  location_id       uuid        NOT NULL,
  order_ref         text        NOT NULL,
  order_total_minor bigint      NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON store.counter_authorization_meta TO yourtal_app;
