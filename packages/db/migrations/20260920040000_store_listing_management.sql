-- YT-0130/YT-0131/YT-0132 (backend halves): the store module's own listing
-- lifecycle, search and repricing audit trail.
--
-- Until this migration, store.listings existed only as fixture storage
-- (YT-0519, YT-0502): something to seed and read, never something apps/api
-- wrote to. This adds exactly what the store module's write path needs and
-- nothing the ledger owns.

-- lifecycle_state is MERCHANT-side visibility. It is deliberately separate
-- from `status`, which is the CUSTOMER-facing availability signal
-- (available/sold_out/expiring_soon/new, unaffected by pausing) -- pausing a
-- listing removes it from the browse/offer-detail query entirely rather than
-- adding a value to that public enum. There is no 'draft' or
-- 'pending_approval' state here: a created listing is immediately 'active'.
-- listing.yaml's approve_listing/reject_listing Cerbos actions already
-- anticipate an ops moderation queue ahead of that, but this pass does not
-- build it -- see the ticket report.
--
-- per_user_limit is nullable: NULL means unlimited, the same convention
-- minimum_spend_idr already uses for "not applicable".
ALTER TABLE store.listings
  ADD COLUMN lifecycle_state text NOT NULL DEFAULT 'active'
    CHECK (lifecycle_state IN ('active', 'paused', 'retired')),
  ADD COLUMN per_user_limit  integer
    CHECK (per_user_limit IS NULL OR per_user_limit > 0);

-- Full-text search over the two fields a merchant actually writes prose
-- into. `simple` rather than a language-specific config: the catalogue mixes
-- Indonesian and English merchant copy (docs/17), and `simple` (no stemming,
-- no stopword removal) is honest about not doing linguistic analysis for
-- either language rather than silently doing it for one.
CREATE INDEX listings_search_idx ON store.listings
  USING GIN (to_tsvector('simple', title || ' ' || description));

CREATE INDEX listings_category_idx ON store.listings (category);
CREATE INDEX listings_price_idx    ON store.listings (price_in_points);
CREATE INDEX listings_lifecycle_idx ON store.listings (lifecycle_state);

-- Every settlement-value change, audited. docs/17 section 2.1 names a
-- material S decrease as one of the three two-person-approval actions, and S
-- is what the platform pays the merchant at redemption -- a quiet revision
-- moves real money on every future redemption.
--
-- new_price_in_points is nullable BECAUSE the store module cannot compute
-- it: yourtal_app has no grant on the ledger schema at all
-- (`REVOKE ALL ON SCHEMA ledger FROM yourtal_app`,
-- infra/postgres/init/01-schemas.sql), and points_price = S / B needs B,
-- which lives there. A row with new_price_in_points IS NULL names a listing
-- whose stored price_in_points is now stale and awaiting whatever closes
-- this seam from the ledger side -- this migration does not invent a value
-- for it, and store.listings.price_in_points is left UNCHANGED by the store
-- module when S changes, rather than being set to a number nobody can
-- currently prove correct.
CREATE TABLE store.listing_price_revision (
  id                             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id                     uuid        NOT NULL REFERENCES store.listings (id),
  previous_settlement_value_idr  bigint      NOT NULL CHECK (previous_settlement_value_idr >= 0),
  new_settlement_value_idr       bigint      NOT NULL CHECK (new_settlement_value_idr >= 0),
  previous_price_in_points       bigint      NOT NULL CHECK (previous_price_in_points >= 0),
  new_price_in_points            bigint      CHECK (new_price_in_points IS NULL OR new_price_in_points >= 0),
  requested_by                   uuid        NOT NULL,
  reason                         text,
  created_at                     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX listing_price_revision_listing_idx ON store.listing_price_revision (listing_id);

-- The seam a future ledger-side repricing job scans: every revision still
-- awaiting a real points price.
CREATE INDEX listing_price_revision_pending_idx ON store.listing_price_revision (listing_id)
  WHERE new_price_in_points IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON store.listing_price_revision TO yourtal_app;
