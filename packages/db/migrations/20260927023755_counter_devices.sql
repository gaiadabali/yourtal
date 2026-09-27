-- TASKS.md 8.1.a: a counter device is its own principal (store_device,
-- docs/17 section 2.2), never a person's account. This table is what
-- Studio -> Team -> Devices provisions and what the pairing/unlock/redemption
-- routes read back.
--
-- Two composite FKs make the two cross-tenant mistakes unrepresentable at
-- the database layer, not merely refused by application code:
--   - a device's own business must sit in that business's own region (a
--     second copy of F2's wall, the same defence-in-depth move
--     `business_accounts_currency_matches_region` already makes);
--   - a device's location must actually belong to its own business, the
--     same shape `vouchers_location_is_offered_by_its_listing` already
--     enforces for a voucher's own branch (20260919000009_merchant_locations).
-- Both need a composite UNIQUE on the referenced side first, since neither
-- table had one before this ticket needed it.

ALTER TABLE business.business_accounts
  ADD CONSTRAINT business_accounts_id_region_key UNIQUE (id, region);

ALTER TABLE store.merchant_location
  ADD CONSTRAINT merchant_location_id_merchant_id_key UNIQUE (id, merchant_id);

CREATE TABLE store.counter_device (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          uuid        NOT NULL,
  region               text        NOT NULL CHECK (region IN ('AU', 'ID')),
  location_id          uuid        NOT NULL,
  label                text        NOT NULL,
  -- Argon2id (TASKS.md 8.1.a), unlike the unsalted SHA-256 in the old web
  -- prototype's pin-hash.ts -- this table replaces that trust boundary
  -- entirely rather than importing its shortcut.
  pin_hash             text        NOT NULL,
  -- NULL until the device completes its one-time pairing; sha256 of a
  -- 32-byte random secret the device never has to store in the clear on
  -- this side (the plaintext secret is returned exactly once, at pairing).
  credential_hash      text,
  pairing_code_hash    text        NOT NULL,
  pairing_expires_at   timestamptz NOT NULL,
  paired_at            timestamptz,
  failed_pin_attempts  integer     NOT NULL DEFAULT 0,
  pin_locked_until     timestamptz,
  revoked_at           timestamptz,
  revoked_by           text,
  created_by           text        NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT counter_device_business_region_matches
    FOREIGN KEY (business_id, region) REFERENCES business.business_accounts (id, region),
  CONSTRAINT counter_device_location_is_its_own_business
    FOREIGN KEY (business_id, location_id) REFERENCES store.merchant_location (merchant_id, id),
  -- A device is either still awaiting its one pairing attempt (no
  -- credential yet) or fully paired (credential and timestamp both set) --
  -- never a state with one but not the other.
  CONSTRAINT counter_device_paired_state_is_whole CHECK (
    (paired_at IS NULL AND credential_hash IS NULL) OR
    (paired_at IS NOT NULL AND credential_hash IS NOT NULL)
  )
);

CREATE UNIQUE INDEX counter_device_pairing_code_hash_key ON store.counter_device (pairing_code_hash);
CREATE UNIQUE INDEX counter_device_credential_hash_key
  ON store.counter_device (credential_hash) WHERE credential_hash IS NOT NULL;
CREATE INDEX counter_device_business_idx ON store.counter_device (business_id);

GRANT SELECT, INSERT, UPDATE ON store.counter_device TO yourtal_app;
