-- 13.20 (F86): a viewer gifts an unused voucher once to another verified
-- adult in the same region. The old code is voided (reason `transfer`) and a
-- new voucher is minted into `allocated` with no owner until the recipient
-- accepts; after 7 days it goes to the sender instead.

-- Lets a gift's two vouchers be pinned to the gift's own region below.
ALTER TABLE voucher.vouchers
  ADD CONSTRAINT vouchers_id_region_key UNIQUE (id, region);

CREATE TABLE voucher.gift (
  id                uuid        PRIMARY KEY,
  source_voucher_id uuid        NOT NULL UNIQUE,
  voucher_id        uuid        NOT NULL UNIQUE,
  sender_id         uuid        NOT NULL,
  recipient_id      uuid        NOT NULL,
  region            text        NOT NULL CHECK (region IN ('AU', 'ID')),
  state             text        NOT NULL DEFAULT 'pending'
                                CHECK (state IN ('pending', 'accepted', 'returned')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  resolved_at       timestamptz,

  -- AU and ID never cross: both vouchers are in the gift's region.
  CONSTRAINT gift_source_in_region
    FOREIGN KEY (source_voucher_id, region) REFERENCES voucher.vouchers (id, region),
  CONSTRAINT gift_voucher_in_region
    FOREIGN KEY (voucher_id, region) REFERENCES voucher.vouchers (id, region),
  CONSTRAINT gift_not_to_self
    CHECK (sender_id <> recipient_id OR sender_id = '00000000-0000-0000-0000-000000000000'::uuid),
  CONSTRAINT gift_resolved_iff_not_pending CHECK ((state = 'pending') = (resolved_at IS NULL))
);

CREATE INDEX gift_sender_idx ON voucher.gift (sender_id, created_at);
CREATE INDEX gift_recipient_idx ON voucher.gift (recipient_id, created_at);
CREATE INDEX gift_pending_due_idx ON voucher.gift (expires_at) WHERE state = 'pending';

GRANT SELECT, INSERT ON voucher.gift TO yourtal_voucher;
GRANT UPDATE (state, resolved_at) ON voucher.gift TO yourtal_voucher;

-- DSAR: a gift names two people, so erasure severs both, as it does a
-- voucher's owner. Same pinned, definer-owned shape as 20260920034654.
CREATE OR REPLACE FUNCTION voucher.anonymise_owner(subject uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, voucher
AS $$
DECLARE
  severed integer;
BEGIN
  IF subject = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'voucher: the tombstone is not a subject'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE voucher.vouchers
     SET owner_id = '00000000-0000-0000-0000-000000000000'::uuid
   WHERE owner_id = subject;
  GET DIAGNOSTICS severed = ROW_COUNT;

  UPDATE voucher.gift SET sender_id = '00000000-0000-0000-0000-000000000000'::uuid
   WHERE sender_id = subject;
  UPDATE voucher.gift SET recipient_id = '00000000-0000-0000-0000-000000000000'::uuid
   WHERE recipient_id = subject;

  RETURN severed;
END;
$$;

ALTER FUNCTION voucher.anonymise_owner(uuid) OWNER TO yourtal_voucher;
REVOKE ALL ON FUNCTION voucher.anonymise_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION voucher.anonymise_owner(uuid) TO yourtal_app;
GRANT UPDATE (sender_id, recipient_id) ON voucher.gift TO yourtal_voucher;

-- The fake voucher engine's copy (LEDGER_MODE=fake), same shape.
CREATE TABLE platform.voucher_fake_gift (
  id                uuid        PRIMARY KEY,
  source_voucher_id uuid        NOT NULL UNIQUE REFERENCES platform.voucher_fake_voucher (id),
  voucher_id        uuid        NOT NULL UNIQUE REFERENCES platform.voucher_fake_voucher (id),
  sender_id         uuid        NOT NULL,
  recipient_id      uuid        NOT NULL,
  region            text        NOT NULL CHECK (region IN ('AU', 'ID')),
  state             text        NOT NULL DEFAULT 'pending'
                                CHECK (state IN ('pending', 'accepted', 'returned')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  resolved_at       timestamptz
);

GRANT SELECT, INSERT, UPDATE ON platform.voucher_fake_gift TO yourtal_app;
