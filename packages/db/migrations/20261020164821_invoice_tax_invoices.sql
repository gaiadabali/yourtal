-- 5.3 / 14.9 (F118, F107): GST tax invoices for what a brand pays for points
-- and boosts. An invoice is a snapshot: the issuer's and the buyer's details
-- are copied in at issue time, so a PDF rendered later is identical to the
-- first one, and nothing here is ever updated or deleted (F107: purchases are
-- final, so there are no adjustment notes yet).
--
-- `is_tax_invoice` is true only while the issuer has a valid ABN; until the
-- AU company exists (group 6.1.a) every document is a plain "Invoice".
CREATE SCHEMA IF NOT EXISTS invoice;
GRANT USAGE ON SCHEMA invoice TO yourtal_app;

-- One gapless counter per region. An issuer locks its row in the same
-- transaction that inserts the invoice, so two concurrent issues never share
-- a number, and a rolled-back issue gives its number back.
CREATE TABLE invoice.counter (
  region      text   PRIMARY KEY CHECK (region IN ('AU', 'ID')),
  last_number bigint NOT NULL DEFAULT 0 CHECK (last_number >= 0)
);
INSERT INTO invoice.counter (region) VALUES ('AU'), ('ID');

CREATE TABLE invoice.invoice (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  region            text        NOT NULL CHECK (region IN ('AU', 'ID')),
  seq               bigint      NOT NULL CHECK (seq > 0),
  number            text        NOT NULL UNIQUE,
  business_id       uuid        NOT NULL,
  -- What was paid for: a card purchase, a charged boost batch, or a purchase
  -- staff approved by hand. A source is invoiced once.
  source_kind       text        NOT NULL CHECK (source_kind IN ('card_purchase', 'boost_batch', 'manual_purchase')),
  source_id         uuid        NOT NULL,
  issued_at         timestamptz NOT NULL DEFAULT now(),
  currency          text        NOT NULL CHECK (currency IN ('AUD', 'IDR')),
  subtotal_minor    bigint      NOT NULL CHECK (subtotal_minor > 0),
  tax_minor         bigint      NOT NULL CHECK (tax_minor >= 0),
  total_minor       bigint      NOT NULL,
  tax_rate_bps      integer     NOT NULL CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  -- The issuing company as it was when this was issued.
  issuer_legal_name text        NOT NULL,
  issuer_abn        text,
  issuer_address    text        NOT NULL,
  issuer_email      text        NOT NULL,
  -- The buyer as its own record said at the time; the ABN only if it has one.
  buyer_legal_name  text        NOT NULL,
  buyer_abn         text,
  is_tax_invoice    boolean     NOT NULL,
  payment_ref       text,
  CONSTRAINT invoice_total CHECK (total_minor = subtotal_minor + tax_minor),
  CONSTRAINT invoice_currency_matches_region CHECK ((region = 'AU') = (currency = 'AUD')),
  -- Six digits at least; lpad would cut a longer number, so the zeros are counted by hand.
  CONSTRAINT invoice_number_format CHECK (
    number = 'YT-' || region || '-' || repeat('0', greatest(6 - length(seq::text), 0)) || seq::text),
  CONSTRAINT invoice_tax_needs_abn CHECK (NOT is_tax_invoice OR issuer_abn IS NOT NULL),
  CONSTRAINT invoice_region_seq_key UNIQUE (region, seq),
  CONSTRAINT invoice_source_key UNIQUE (source_kind, source_id)
);
CREATE INDEX invoice_business_idx ON invoice.invoice (business_id, issued_at DESC);

CREATE TABLE invoice.line (
  invoice_id     uuid   NOT NULL REFERENCES invoice.invoice (id),
  position       integer NOT NULL CHECK (position > 0),
  description    text   NOT NULL,
  quantity       bigint NOT NULL CHECK (quantity > 0),
  unit_minor     bigint NOT NULL CHECK (unit_minor > 0),
  subtotal_minor bigint NOT NULL CHECK (subtotal_minor > 0),
  tax_minor      bigint NOT NULL CHECK (tax_minor >= 0),
  PRIMARY KEY (invoice_id, position),
  CONSTRAINT line_subtotal CHECK (subtotal_minor = quantity * unit_minor)
);

-- An issued invoice never changes, whoever asks.
CREATE FUNCTION invoice.refuse_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'invoice: % rows are never changed or deleted once issued', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER invoice_immutable BEFORE UPDATE OR DELETE ON invoice.invoice
  FOR EACH ROW EXECUTE FUNCTION invoice.refuse_change();
CREATE TRIGGER line_immutable BEFORE UPDATE OR DELETE ON invoice.line
  FOR EACH ROW EXECUTE FUNCTION invoice.refuse_change();

GRANT SELECT, UPDATE ON invoice.counter TO yourtal_app;
GRANT SELECT, INSERT ON invoice.invoice, invoice.line TO yourtal_app;

ALTER TABLE invoice.counter ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON invoice.counter
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE invoice.invoice ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON invoice.invoice
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

-- A line has no region of its own: it follows its invoice.
ALTER TABLE invoice.line ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON invoice.line
  USING (EXISTS (SELECT 1 FROM invoice.invoice i WHERE i.id = invoice_id))
  WITH CHECK (EXISTS (SELECT 1 FROM invoice.invoice i WHERE i.id = invoice_id));

-- A source that cannot be invoiced (its business is gone, its payload is
-- invalid) is remembered, so the job leaves it out of the next batches for a
-- while and the sources behind it are not starved. A whole-region wait (no
-- issuer settings yet) is never recorded here.
CREATE TABLE invoice.issue_skip (
  source_kind   text        NOT NULL CHECK (source_kind IN ('card_purchase', 'boost_batch', 'manual_purchase')),
  source_id     uuid        NOT NULL,
  region        text        CHECK (region IN ('AU', 'ID')),
  reason        text        NOT NULL,
  last_tried_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_kind, source_id)
);
GRANT SELECT, INSERT, UPDATE ON invoice.issue_skip TO yourtal_app;
ALTER TABLE invoice.issue_skip ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON invoice.issue_skip
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

-- The issuing company is the `invoice_issuer` region setting ({legalName, abn,
-- address, email}, edited in the staff console with two-person approval).
-- Nothing is seeded here: until finance approves the real company's details,
-- issuing waits. Staging and dev get demo details from their seed.
