-- YT-0140 / YT-0141: voucher code custody, issuance batches, and the
-- per-voucher hash-chained event log.
--
-- ## Additive on purpose — the surgery on `voucher.vouchers` is a separate
-- ## migration
--
-- The lifecycle state machine (YT-0142) replaces `voucher.vouchers.status`
-- with the full minted/allocated/active/held/redeemed/expired/voided set,
-- and the plaintext `code` column is deleted outright. Both of those change
-- `packages/contracts` in the same breath — `voucherSchema.status` becomes
-- derived, `code` becomes a field with no column — and a schema change that
-- lands ahead of its contract has cost two streams their verification
-- already this week (see the header of `schema-drift.test.ts`).
--
-- So this migration adds only what nothing else reads yet, and the columns
-- that break things move together with the contract in one change.
--
-- ## The voucher service gets its own role
--
-- docs/15 makes `voucher` one of the six Phase 1 deployables and docs/13
-- asks for module boundaries enforced twice: once in code, once underneath.
-- After this migration the app role can read a batch — the store has to show
-- a user what policy their voucher carries before they spend points — and
-- cannot write one, and cannot see custody at all.
--
-- ⚠️ Risk 45 (recorded 2026-09-20): the running application currently
-- connects as a superuser with BYPASSRLS, so these grants are enforced in
-- tests and bypassed by the live process until YT-0554 lands. They are
-- written as though they hold, because they will — but nothing here should
-- be cited as evidence that a boundary held at runtime.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yourtal_voucher') THEN
    CREATE ROLE yourtal_voucher LOGIN PASSWORD 'voucher_local_only';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA voucher, store, platform TO yourtal_voucher;
GRANT SELECT, INSERT, UPDATE ON platform.idempotency TO yourtal_voucher;
GRANT SELECT ON store.listings, store.listing_location, store.merchant_location
  TO yourtal_voucher;
GRANT SELECT, INSERT, UPDATE ON voucher.vouchers TO yourtal_voucher;

-- ---------------------------------------------------------------------------
-- Batches: nothing is minted without a funding record and a second person
-- ---------------------------------------------------------------------------
CREATE TABLE voucher.batch (
  id                        uuid        PRIMARY KEY,
  listing_id                uuid        NOT NULL REFERENCES store.listings (id),
  supplier_business_id      uuid        NOT NULL,

  -- YT-0141's two-person rule, as a constraint. An approval you can give
  -- yourself is a form on a screen, not a control — and what is being
  -- authorised is the creation of bearer instruments with face value.
  requested_by              uuid        NOT NULL,
  approved_by               uuid,

  quantity                  integer     NOT NULL CHECK (quantity > 0),

  -- The terms every voucher in this batch is minted under. Per-BATCH, which
  -- is what docs/09 §8.2 requires: "the policy must be a per-batch flag,
  -- displayed prominently before the user spends their points."
  face_value_minor          bigint      NOT NULL CHECK (face_value_minor > 0),
  settlement_value_minor    bigint      NOT NULL CHECK (settlement_value_minor > 0),
  currency                  char(3)     NOT NULL CHECK (currency IN ('IDR', 'AUD')),
  transferable              boolean     NOT NULL,
  partial_redemption_policy text        NOT NULL CHECK (
    partial_redemption_policy IN ('balance_carrying', 'single_use_forfeit', 'minimum_spend')),
  minimum_spend_minor       bigint,
  expires_at                timestamptz NOT NULL,

  -- "Every batch carries a funding record so the liability is always
  -- attributable" (YT-0141). Free text is deliberate: at Phase 1 this is a
  -- partner purchase id or a signed marketing authorisation, and a foreign
  -- key now would either block the batch or invent a purchase to point at.
  -- What is not optional is that something is written here.
  funding_reference         text        NOT NULL CHECK (char_length(funding_reference) > 0),

  -- The signed manifest of what was actually minted (YT-0141). Null until
  -- minting finishes, because it is a hash OF the result.
  manifest_sha256           char(64),

  state                     text        NOT NULL CHECK (
    state IN ('requested', 'approved', 'minting', 'minted', 'rejected')),
  created_at                timestamptz NOT NULL DEFAULT now(),
  approved_at               timestamptz,

  -- The same economic invariant `store.listings` carries: settlement above
  -- face value means the platform pays out more than the voucher was ever
  -- worth, on every redemption, silently.
  CONSTRAINT batch_settlement_within_face CHECK (settlement_value_minor <= face_value_minor),
  CONSTRAINT batch_minimum_spend_iff_policy CHECK (
    (partial_redemption_policy = 'minimum_spend') = (minimum_spend_minor IS NOT NULL)
  ),

  CONSTRAINT batch_approver_is_a_second_person CHECK (
    approved_by IS NULL OR approved_by <> requested_by
  ),
  -- Approval is not a flag somebody can forget to check: the states that
  -- permit minting are exactly the states that carry an approver.
  CONSTRAINT batch_approved_state_has_an_approver CHECK (
    (state IN ('approved', 'minting', 'minted')) = (approved_by IS NOT NULL)
  ),
  CONSTRAINT batch_approved_at_iff_approver CHECK (
    (approved_by IS NULL) = (approved_at IS NULL)
  ),
  CONSTRAINT batch_manifest_iff_minted CHECK (
    (state = 'minted') = (manifest_sha256 IS NOT NULL)
  )
);

CREATE INDEX batch_listing_idx  ON voucher.batch (listing_id);
CREATE INDEX batch_supplier_idx ON voucher.batch (supplier_business_id);
CREATE INDEX batch_state_idx    ON voucher.batch (state);

GRANT SELECT, INSERT, UPDATE ON voucher.batch TO yourtal_voucher;
GRANT SELECT ON voucher.batch TO yourtal_app;

-- ---------------------------------------------------------------------------
-- Code custody
-- ---------------------------------------------------------------------------
--
-- docs/15's seventh rule: "voucher codes KMS-encrypted from the first code
-- ever minted." A voucher is a bearer instrument — whoever holds the code
-- holds the money, and there is no account to freeze afterwards — so a
-- plaintext code column readable by the application role means one leaked
-- credential, or one read-only injection anywhere in the store service, is
-- the entire voucher float.
--
-- Encrypting that column in place would not have worked either, because the
-- lookup still has to run: `WHERE code = $1` against ciphertext needs
-- deterministic encryption, and deterministic encryption is a dictionary
-- away from being no encryption at all.
--
-- So a code becomes two facts, in a table the app role cannot see:
--
--   * `code_hash` — SHA-256 of the normalised code, for lookup. Not a
--     password hash, deliberately: the input is 80 bits of CSPRNG output
--     over a 32-symbol alphabet, so there is no dictionary to try and
--     nothing for a slow KDF to slow down. What it buys is that a dump of
--     this table cannot be redeemed.
--   * the envelope-encrypted code, for display to its owner and nobody else.
--
-- The data key is per-record and itself encrypted under a purpose-scoped
-- master key (`services/voucher/internal/keyring`), so rotating the master
-- re-wraps keys rather than re-encrypting every voucher — and YT-0026's
-- eventual move to a real KMS is a change of who unwraps, not a migration of
-- the data. YT-0533 provides the custody this depends on; it is a real
-- dependency, not a formality, and there is no KMS behind it on Helios.
CREATE TABLE voucher.code_custody (
  voucher_id       uuid        PRIMARY KEY REFERENCES voucher.vouchers (id),

  -- UNIQUE, so a duplicate mint is refused by the database rather than by
  -- the minting loop noticing.
  code_hash        char(64)    NOT NULL UNIQUE,

  wrapped_data_key bytea       NOT NULL,
  nonce            bytea       NOT NULL,
  ciphertext       bytea       NOT NULL,
  key_purpose      text        NOT NULL CHECK (key_purpose = 'voucher_code'),
  key_version      integer     NOT NULL CHECK (key_version > 0),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- The whole point: a compromised store service can list vouchers and cannot
-- redeem one.
GRANT SELECT, INSERT ON voucher.code_custody TO yourtal_voucher;
REVOKE ALL ON voucher.code_custody FROM yourtal_app;

-- ---------------------------------------------------------------------------
-- The per-voucher hash-chained event log (YT-0140)
-- ---------------------------------------------------------------------------
--
-- Hash-chained rather than merely appended, because docs/09 §10 promises the
-- merchant a trail that is "replayable, exportable" — and a plain audit table
-- proves nothing to somebody who does not already trust whoever operates the
-- database it lives in. Each row commits to its predecessor, so removing or
-- editing one breaks every hash after it, and the break is detectable
-- without knowing what the row used to say.
CREATE TABLE voucher.event (
  voucher_id  uuid        NOT NULL REFERENCES voucher.vouchers (id),
  seq         integer     NOT NULL CHECK (seq > 0),
  event_type  text        NOT NULL,
  detail      jsonb       NOT NULL,
  -- The first event of a voucher commits to 64 zeroes.
  prev_hash   char(64)    NOT NULL,
  hash        char(64)    NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  -- (voucher_id, seq) as the key is what serialises the chain: two writers
  -- racing to append event 4 cannot both succeed, so a fork in the chain is
  -- unrepresentable rather than merely unlikely.
  PRIMARY KEY (voucher_id, seq)
);

CREATE INDEX event_voucher_time_idx ON voucher.event (voucher_id, occurred_at);

GRANT SELECT, INSERT ON voucher.event TO yourtal_voucher;
GRANT SELECT ON voucher.event TO yourtal_app;
REVOKE UPDATE, DELETE ON voucher.event FROM yourtal_voucher, yourtal_app;
