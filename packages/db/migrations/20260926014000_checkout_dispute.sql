-- 4.7.c, K13: one dispute per voucher. `reinstated` returned the points at
-- once; `queued` (the voucher was captured) waits for staff (9.4) and the
-- merchant recovery line (10.1).
CREATE TABLE checkout.dispute (
  voucher_id uuid        PRIMARY KEY,
  saga_id    uuid        NOT NULL REFERENCES checkout.saga (id),
  user_id    uuid        NOT NULL,
  reason     text        NOT NULL CHECK (reason IN ('not_honoured', 'merchant_closed', 'other')),
  outcome    text        NOT NULL CHECK (outcome IN ('reinstated', 'queued')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dispute_queued ON checkout.dispute (created_at) WHERE outcome = 'queued';

GRANT SELECT, INSERT ON checkout.dispute TO yourtal_app;
REVOKE UPDATE, DELETE ON checkout.dispute FROM yourtal_app;
