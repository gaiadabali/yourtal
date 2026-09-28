-- TASKS.md 8.3.e (found by 8.3.c): every capture and refund the voucher
-- service itself settles writes a webhook outbox row in the SAME
-- transaction as the state change -- the same shape voucher.capture_outbox
-- (4.6.f) already uses for posting captures to the ledger, so a capture
-- made through the merchant HMAC API or the counter/device route is
-- notified from one place instead of the BFF guessing at it after the fact.
--
-- apps/worker (not this service -- see internal/ledgerpost's own header for
-- why capture_outbox is drained in-process instead) polls this table over
-- services/voucher's /internal/v1 (serviceauth), same as it polls the
-- ledger's release notices, and hands each row to the 8.3.c signer.
-- `posted_at` is apps/worker's own marker, set only after the delivery job
-- has taken it -- "posted" here means "handed to the delivery queue", not
-- "the webhook succeeded"; retries past that point are the delivery job's
-- own job (8.3.c's pg-boss backoff), not this table's.
CREATE TABLE voucher.webhook_outbox (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      text        NOT NULL CHECK (event_type IN ('voucher.captured', 'voucher.refunded', 'voucher.expired')),
  merchant_id     uuid        NOT NULL,
  idempotency_key text        NOT NULL UNIQUE,
  payload         jsonb       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  posted_at       timestamptz
);

CREATE INDEX webhook_outbox_unposted_idx ON voucher.webhook_outbox (created_at) WHERE posted_at IS NULL;

-- The Go service writes one row per capture/refund, inside that
-- transaction, and marks posted through the same /internal/v1 routes
-- apps/worker calls.
GRANT SELECT, INSERT, UPDATE ON voucher.webhook_outbox TO yourtal_voucher;
