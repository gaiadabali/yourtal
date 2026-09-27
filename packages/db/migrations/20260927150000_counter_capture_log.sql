-- TASKS.md 8.2.b/8.2.g: the counter BFF's own audit trail. `services/voucher`
-- (4.5/4.6) is the source of truth for a capture's money -- this table never
-- moves value, it only records that THIS device made THIS call, for the
-- receipt on both sides and for Studio -> Redemptions. Area C owns it
-- outright (unlike store.counter_device, which references business/store
-- tables another module reads): no other module writes it.

CREATE TABLE store.counter_capture_log (
  capture_id            text        PRIMARY KEY,
  device_id             uuid        NOT NULL REFERENCES store.counter_device (id),
  business_id           uuid        NOT NULL,
  location_id           uuid        NOT NULL,
  voucher_id            uuid        NOT NULL,
  amount_minor          bigint      NOT NULL,
  currency              text        NOT NULL,
  order_ref             text        NOT NULL,
  order_total_minor     bigint      NOT NULL,
  authorized_at         timestamptz NOT NULL,
  captured_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX counter_capture_log_business_captured_idx
  ON store.counter_capture_log (business_id, captured_at DESC);
CREATE INDEX counter_capture_log_device_captured_idx
  ON store.counter_capture_log (device_id, captured_at DESC);

GRANT SELECT, INSERT ON store.counter_capture_log TO yourtal_app;
