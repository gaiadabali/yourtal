-- YT-0150 / YT-0151 / YT-0152 / YT-0153 / YT-0155: the merchant redemption
-- network.
--
-- docs/09 §8 takes the shape card networks already solved: authorize →
-- capture → void / refund. What follows is that protocol expressed as
-- constraints, because the failure modes here are not crashes. A voucher
-- redeemed twice, a capture larger than its authorization, a hold that
-- never expires and locks a customer's voucher inside an abandoned cart —
-- each one is a correct-looking sequence of statements that nothing objects
-- to unless the schema does.

-- ---------------------------------------------------------------------------
-- Authorization: a hold with a TTL
-- ---------------------------------------------------------------------------
CREATE TABLE voucher.authorization (
  id                  uuid        PRIMARY KEY,
  voucher_id          uuid        NOT NULL REFERENCES voucher.vouchers (id),
  merchant_id         uuid        NOT NULL,

  -- docs/09 §8.1: "authorize requires an amount and a merchant order
  -- reference. There is deliberately NO bare balance-lookup endpoint for
  -- merchants — that is the enumeration surface that gets gift-card systems
  -- drained." Both are NOT NULL here so the API cannot grow a version of
  -- this call that omits them.
  amount_minor        bigint      NOT NULL CHECK (amount_minor > 0),
  currency            char(3)     NOT NULL CHECK (currency IN ('IDR', 'AUD')),
  merchant_order_ref  text        NOT NULL CHECK (char_length(merchant_order_ref) BETWEEN 1 AND 128),

  state               text        NOT NULL CHECK (state IN ('held', 'captured', 'voided', 'expired')),

  -- "Holds expire automatically (15 min default), so an abandoned cart
  -- cannot lock a voucher forever." The expiry is a stored instant rather
  -- than a job's opinion: a sweeper that stops running must not silently
  -- turn every hold into a permanent one, so every read filters on this
  -- column and the sweeper only tidies up.
  expires_at          timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  resolved_at         timestamptz,

  CONSTRAINT authorization_expires_after_creation CHECK (expires_at > created_at),
  CONSTRAINT authorization_resolved_iff_not_held CHECK ((state = 'held') = (resolved_at IS NULL))
);

-- **One live hold per voucher.** This is YT-0150's "concurrent authorize on
-- one voucher is serialised", and it is a partial unique index rather than a
-- check in the service because that is the only thing that settles a race.
-- Two tills scanning the same code at the same instant both read "no hold",
-- both insert, and exactly one of them gets a unique violation.
CREATE UNIQUE INDEX authorization_one_live_hold_per_voucher
  ON voucher.authorization (voucher_id) WHERE state = 'held';

-- One cart authorizes once. Without this a merchant retrying a failed call
-- with a fresh idempotency key places a second hold on the same order, and
-- the customer's voucher is held twice for one purchase.
CREATE UNIQUE INDEX authorization_one_per_merchant_order
  ON voucher.authorization (merchant_id, merchant_order_ref);

CREATE INDEX authorization_expiry_idx ON voucher.authorization (expires_at) WHERE state = 'held';
CREATE INDEX authorization_merchant_idx ON voucher.authorization (merchant_id, created_at);

-- ---------------------------------------------------------------------------
-- Capture: never more than was authorized
-- ---------------------------------------------------------------------------
--
-- "Capture cannot exceed the authorized amount; enforced server-side"
-- (YT-0151). Enforced *here* rather than server-side, by the trick this
-- repo already uses for a voucher's branch: the authorized amount is
-- carried on the capture row, and a COMPOSITE foreign key makes the copy
-- unable to disagree with the authorization it came from. Then
-- `amount_minor <= authorized_amount_minor` is a plain CHECK, and there is
-- no reading of another table to get it wrong under concurrency.
ALTER TABLE voucher.authorization ADD CONSTRAINT authorization_id_amount_unique
  UNIQUE (id, amount_minor);

CREATE TABLE voucher.capture (
  id                      uuid        PRIMARY KEY,
  -- UNIQUE: an authorization is captured at most once. A second capture
  -- against one hold is a double-spend wearing the clothes of a retry.
  authorization_id        uuid        NOT NULL UNIQUE,
  authorized_amount_minor bigint      NOT NULL,
  amount_minor            bigint      NOT NULL CHECK (amount_minor > 0),
  receipt_id              text        NOT NULL UNIQUE,

  -- docs/09 §8.1: "once SETTLED, a transaction can only be refunded, never
  -- voided". Null until the settlement run includes it, which is also what
  -- the dispute-window hold in §10 is measured from.
  settled_at              timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT capture_within_authorization CHECK (amount_minor <= authorized_amount_minor),

  FOREIGN KEY (authorization_id, authorized_amount_minor)
    REFERENCES voucher.authorization (id, amount_minor)
);

CREATE INDEX capture_settlement_idx ON voucher.capture (settled_at);

-- ---------------------------------------------------------------------------
-- Refund: restores value after capture
-- ---------------------------------------------------------------------------
CREATE TABLE voucher.refund (
  id           uuid        PRIMARY KEY,
  capture_id   uuid        NOT NULL REFERENCES voucher.capture (id),
  amount_minor bigint      NOT NULL CHECK (amount_minor > 0),
  reason       text        NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX refund_capture_idx ON voucher.refund (capture_id);

-- Refunds may not exceed what was captured, in total rather than one at a
-- time. That is a statement about a SET of rows, so it cannot be a CHECK —
-- the same reason the ledger's balance invariant is a deferred constraint
-- trigger, and the same remedy.
CREATE OR REPLACE FUNCTION voucher.assert_refunds_within_capture() RETURNS trigger AS $$
DECLARE
  refunded bigint;
  captured bigint;
BEGIN
  SELECT COALESCE(SUM(amount_minor), 0) INTO refunded
    FROM voucher.refund WHERE capture_id = NEW.capture_id;

  SELECT amount_minor INTO captured
    FROM voucher.capture WHERE id = NEW.capture_id;

  IF refunded > captured THEN
    RAISE EXCEPTION 'voucher: refunds on capture % total %, which exceeds the % captured',
      NEW.capture_id, refunded, captured
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER refund_within_capture_at_commit
  AFTER INSERT ON voucher.refund
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION voucher.assert_refunds_within_capture();

-- ---------------------------------------------------------------------------
-- Merchant credentials (YT-0152)
-- ---------------------------------------------------------------------------
--
-- Per-merchant API key with HMAC-SHA256 request signing. The shared secret
-- is envelope-encrypted exactly as a voucher code is — it authorises value
-- movement, so it is custody material, not configuration.
--
-- Rotation with overlap is why a merchant may hold more than one active
-- credential: a merchant cannot swap a key atomically across their own
-- fleet, so a rotation that revoked the old key at the instant the new one
-- appeared would take their till offline. Revocation stays immediate, which
-- is the half that matters in an incident.
CREATE TABLE voucher.merchant_credential (
  key_id           text        PRIMARY KEY,
  merchant_id      uuid        NOT NULL,
  wrapped_data_key bytea       NOT NULL,
  nonce            bytea       NOT NULL,
  ciphertext       bytea       NOT NULL,
  key_purpose      text        NOT NULL CHECK (key_purpose = 'merchant_hmac'),
  key_version      integer     NOT NULL CHECK (key_version > 0),
  state            text        NOT NULL CHECK (state IN ('active', 'superseded', 'revoked')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- When a superseded key stops being accepted. The overlap window, written
  -- down rather than remembered.
  not_after        timestamptz,
  revoked_at       timestamptz,

  CONSTRAINT credential_revoked_at_iff_revoked CHECK ((state = 'revoked') = (revoked_at IS NOT NULL)),
  CONSTRAINT credential_superseded_has_a_deadline CHECK (
    state <> 'superseded' OR not_after IS NOT NULL
  )
);

CREATE INDEX credential_merchant_idx ON voucher.merchant_credential (merchant_id, state);

GRANT SELECT, INSERT, UPDATE ON voucher.merchant_credential TO yourtal_voucher;
REVOKE ALL ON voucher.merchant_credential FROM yourtal_app;

-- ---------------------------------------------------------------------------
-- The kill switch (YT-0153)
-- ---------------------------------------------------------------------------
--
-- "Per-merchant, per-batch and global kill switch, tested." One table for
-- all three scopes rather than three mechanisms, because in an incident the
-- question is "stop this now" and the person answering it should not have to
-- remember which of three tools covers the case in front of them.
--
-- Rows are never deleted. Lifting a kill switch is recorded as a lift, so
-- the timeline of an incident survives the incident.
CREATE TABLE voucher.kill_switch (
  id         uuid        PRIMARY KEY,
  scope      text        NOT NULL CHECK (scope IN ('global', 'merchant', 'batch')),
  -- Null only for the global scope, which has nothing to name.
  scope_id   uuid,
  reason     text        NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
  enabled_by text        NOT NULL,
  enabled_at timestamptz NOT NULL DEFAULT now(),
  lifted_by  text,
  lifted_at  timestamptz,

  CONSTRAINT kill_switch_scope_id_iff_scoped CHECK ((scope = 'global') = (scope_id IS NULL)),
  CONSTRAINT kill_switch_lifted_together CHECK ((lifted_by IS NULL) = (lifted_at IS NULL))
);

-- At most one live switch per scope, so "is this merchant stopped?" is one
-- row rather than an aggregate over a history.
CREATE UNIQUE INDEX kill_switch_one_live_per_scope
  ON voucher.kill_switch (scope, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE lifted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Redemption attempts (YT-0153)
-- ---------------------------------------------------------------------------
--
-- docs/09 §10: "repeated invalid codes from one merchant is THE canonical
-- signal of a compromised key or an enumeration attempt."
--
-- Recorded as rows rather than counted in a metric, for the reason the
-- Reward Engine counts velocity from its grant log: a control enforced
-- against something lossy is not a control, and an evicted cache key or a
-- dropped metric becomes free attempts for whoever notices first.
--
-- No code, and no hash of one, is stored here. An attempt log holding code
-- hashes would be a second custody surface with none of the custody — and
-- the thing being detected is a pattern of failures, which does not need to
-- know what was guessed.
CREATE TABLE voucher.redemption_attempt (
  id          bigserial   PRIMARY KEY,
  merchant_id uuid        NOT NULL,
  outcome     text        NOT NULL CHECK (
    outcome IN ('authorized', 'unknown_code', 'wrong_merchant', 'insufficient_value',
                'inactive_voucher', 'policy_refused', 'killed', 'throttled')),
  amount_minor bigint,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX attempt_merchant_time_idx ON voucher.redemption_attempt (merchant_id, occurred_at);
-- The alerting read: failures per merchant per window, without scanning
-- the successes that dominate the table in ordinary operation.
CREATE INDEX attempt_failures_idx ON voucher.redemption_attempt (merchant_id, occurred_at)
  WHERE outcome <> 'authorized';

GRANT SELECT, INSERT, UPDATE ON voucher.authorization, voucher.capture TO yourtal_voucher;
GRANT SELECT, INSERT ON voucher.refund, voucher.redemption_attempt TO yourtal_voucher;
GRANT SELECT, INSERT, UPDATE ON voucher.kill_switch TO yourtal_voucher;
GRANT USAGE, SELECT ON SEQUENCE voucher.redemption_attempt_id_seq TO yourtal_voucher;

-- The merchant portal reads its own history through the API, never the
-- table; the app role gets the read it needs for reconciliation (YT-0156)
-- and none of the writes.
GRANT SELECT ON voucher.authorization, voucher.capture, voucher.refund TO yourtal_app;
REVOKE INSERT, UPDATE, DELETE ON voucher.authorization, voucher.capture, voucher.refund
  FROM yourtal_app;
