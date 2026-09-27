-- TASKS.md 8.3.c: a business's registered webhook delivery URL, plus the
-- HMAC secret the worker signs deliveries with (distinct from the merchant
-- credential in the previous migration -- a leaked webhook secret can forge
-- deliveries, never redemptions).
--
-- Delivery itself is NOT a new table: `packages/drivers`'s existing
-- `WebhookDriver` (1.6.c, `createSimulatedWebhook`) already records every
-- send into `platform.sim_outbox` with per-idempotency-key dedup and fault
-- injection for retries -- exactly "staging simulates delivery: record the
-- attempts and don't call the internet" (TASKS.md 8.3.c). Reusing it rather
-- than a second outbox is the point of that boundary existing at all.

-- The signing secret is recoverable (AES-256-GCM under WEBHOOK_SECRET_ENCRYPTION_KEY,
-- apps/api/src/modules/devices/developers/crypto/webhook-secret.ts), never a one-way
-- hash: the worker has to independently COMPUTE the same signature the business
-- verifies, which a hash cannot do -- unlike a login credential, this secret is
-- never presented back to us for comparison, only used by us to sign.
CREATE TABLE business.webhook_subscription (
  business_id       uuid        PRIMARY KEY REFERENCES business.business_accounts (id),
  url               text        NOT NULL,
  secret_ciphertext bytea       NOT NULL,
  secret_nonce      bytea       NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON business.webhook_subscription TO yourtal_app;
