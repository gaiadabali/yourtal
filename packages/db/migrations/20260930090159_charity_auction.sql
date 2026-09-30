-- 13.22 (F86): charity auctions. The voucher service escrows the listed
-- voucher (void-and-remint, voucher.escrow); apps/api runs the auction, the
-- bids and their payment holds (auction.*). The winning payment is captured
-- straight into the charity's own provider account: no table here holds a
-- balance, and nothing posts to the ledger (red line 8).

-- The voucher side: one escrow per auction.
CREATE TABLE voucher.escrow (
  auction_id        uuid        PRIMARY KEY,
  source_voucher_id uuid        NOT NULL UNIQUE,
  voucher_id        uuid        NOT NULL UNIQUE,
  seller_id         uuid        NOT NULL,
  region            text        NOT NULL CHECK (region IN ('AU', 'ID')),
  state             text        NOT NULL DEFAULT 'held' CHECK (state IN ('held', 'released')),
  released_to       uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  released_at       timestamptz,
  CONSTRAINT escrow_source_in_region
    FOREIGN KEY (source_voucher_id, region) REFERENCES voucher.vouchers (id, region),
  CONSTRAINT escrow_voucher_in_region
    FOREIGN KEY (voucher_id, region) REFERENCES voucher.vouchers (id, region),
  CONSTRAINT escrow_released_iff_owner
    CHECK ((state = 'released') = (released_to IS NOT NULL AND released_at IS NOT NULL))
);
GRANT SELECT, INSERT ON voucher.escrow TO yourtal_voucher;
GRANT UPDATE (state, released_to, released_at, seller_id) ON voucher.escrow TO yourtal_voucher;

-- DSAR: erasure severs an escrow's seller too.
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
  UPDATE voucher.escrow SET seller_id = '00000000-0000-0000-0000-000000000000'::uuid
   WHERE seller_id = subject;

  RETURN severed;
END;
$$;

ALTER FUNCTION voucher.anonymise_owner(uuid) OWNER TO yourtal_voucher;
REVOKE ALL ON FUNCTION voucher.anonymise_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION voucher.anonymise_owner(uuid) TO yourtal_app;

-- The fake voucher engine's copy (LEDGER_MODE=fake).
CREATE TABLE platform.voucher_fake_escrow (
  auction_id        uuid        PRIMARY KEY,
  source_voucher_id uuid        NOT NULL UNIQUE REFERENCES platform.voucher_fake_voucher (id),
  voucher_id        uuid        NOT NULL UNIQUE REFERENCES platform.voucher_fake_voucher (id),
  seller_id         uuid        NOT NULL,
  region            text        NOT NULL CHECK (region IN ('AU', 'ID')),
  state             text        NOT NULL DEFAULT 'held' CHECK (state IN ('held', 'released')),
  released_to       uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  released_at       timestamptz
);
GRANT SELECT, INSERT, UPDATE ON platform.voucher_fake_escrow TO yourtal_app;

-- An auction is for one approved charity in its own region.
ALTER TABLE charity.charity ADD CONSTRAINT charity_id_region_key UNIQUE (id, region);

CREATE SCHEMA IF NOT EXISTS auction;
GRANT USAGE ON SCHEMA auction TO yourtal_app;

CREATE TABLE auction.auction (
  id                   uuid        PRIMARY KEY,
  region               text        NOT NULL CHECK (region IN ('AU', 'ID')),
  currency             text        NOT NULL,
  seller_id            text        NOT NULL,
  charity_id           uuid        NOT NULL,
  source_voucher_id    uuid        NOT NULL UNIQUE,
  voucher_id           uuid        NOT NULL UNIQUE,
  listing_id           uuid        NOT NULL,
  title                text        NOT NULL,
  merchant_name        text        NOT NULL,
  category             text        NOT NULL,
  face_value_minor     bigint      NOT NULL CHECK (face_value_minor > 0),
  voucher_expires_at   timestamptz NOT NULL,
  reserve_minor        bigint      NOT NULL CHECK (reserve_minor > 0),
  current_amount_minor bigint      CHECK (current_amount_minor >= reserve_minor),
  bid_count            integer     NOT NULL DEFAULT 0 CHECK (bid_count >= 0),
  leader_bid_id        uuid,
  starts_at            timestamptz NOT NULL DEFAULT now(),
  ends_at              timestamptz NOT NULL,
  extensions           integer     NOT NULL DEFAULT 0,
  state                text        NOT NULL DEFAULT 'open'
                                   CHECK (state IN ('open', 'settled', 'cancelled')),
  outcome              text        CHECK (outcome IN ('sold', 'unsold', 'cancelled')),
  cancel_reason        text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  settled_at           timestamptz,
  CONSTRAINT auction_cash_in_its_region
    CHECK ((region = 'AU' AND currency = 'AUD') OR (region = 'ID' AND currency = 'IDR')),
  CONSTRAINT auction_charity_in_region
    FOREIGN KEY (charity_id, region) REFERENCES charity.charity (id, region),
  CONSTRAINT auction_id_region_currency_key UNIQUE (id, region, currency),
  CONSTRAINT auction_outcome_iff_closed CHECK ((state = 'open') = (outcome IS NULL)),
  CONSTRAINT auction_cancel_has_reason CHECK ((state = 'cancelled') = (cancel_reason IS NOT NULL))
);
CREATE INDEX auction_open_idx ON auction.auction (region, ends_at) WHERE state = 'open';
CREATE INDEX auction_seller_idx ON auction.auction (seller_id, created_at);

-- A bid is a payment hold at the provider; nothing is taken until close.
CREATE TABLE auction.bid (
  id             uuid        PRIMARY KEY,
  auction_id     uuid        NOT NULL,
  region         text        NOT NULL,
  currency       text        NOT NULL,
  bidder_id      text        NOT NULL,
  amount_minor   bigint      NOT NULL CHECK (amount_minor > 0),
  hold_reference text        NOT NULL UNIQUE,
  state          text        NOT NULL DEFAULT 'held'
                             CHECK (state IN ('held', 'released', 'captured', 'capture_failed')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz,
  CONSTRAINT bid_in_its_auction_region
    FOREIGN KEY (auction_id, region, currency) REFERENCES auction.auction (id, region, currency)
);
CREATE INDEX bid_auction_idx ON auction.bid (auction_id, amount_minor DESC);
CREATE INDEX bid_bidder_idx ON auction.bid (bidder_id, created_at);

-- At most one settlement per auction: exactly one winner, one capture.
CREATE TABLE auction.settlement (
  auction_id            uuid        PRIMARY KEY REFERENCES auction.auction (id),
  outcome               text        NOT NULL CHECK (outcome IN ('sold', 'unsold', 'cancelled')),
  winning_bid_id        uuid        UNIQUE REFERENCES auction.bid (id),
  winner_id             text,
  amount_minor          bigint,
  currency              text        NOT NULL,
  charity_id            uuid        NOT NULL,
  capture_reference     text        UNIQUE,
  -- The charity's own provider account the capture settled into.
  destination_reference text,
  voucher_owner_id      text        NOT NULL,
  settled_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settlement_sold_is_captured CHECK (
    (outcome = 'sold') = (winning_bid_id IS NOT NULL AND capture_reference IS NOT NULL
                          AND destination_reference IS NOT NULL AND amount_minor IS NOT NULL)
  )
);

-- One receipt per party per auction (seller, winner, charity).
CREATE TABLE auction.receipt (
  auction_id   uuid        NOT NULL REFERENCES auction.auction (id),
  party        text        NOT NULL CHECK (party IN ('seller', 'winner', 'charity')),
  recipient_id text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (auction_id, party)
);

GRANT SELECT, INSERT, UPDATE ON auction.auction, auction.bid TO yourtal_app;
GRANT SELECT, INSERT ON auction.settlement, auction.receipt TO yourtal_app;
