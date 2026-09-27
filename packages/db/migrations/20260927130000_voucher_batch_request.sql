-- 7.4.c: a merchant asking for more stock is a request row, not a direct
-- write to store.listings.stock_remaining (which 7.4.b/c already turned
-- into a read-only projection of `voucher.vouchers` -- see
-- listing-live-values.ts). Approval and the actual mint-through-4.5 belong
-- to Phase 9's staff console (not built yet); this table only carries the
-- request and its state so that work has somewhere to land without a
-- second migration.
CREATE TABLE store.voucher_batch_request (
  id               uuid        PRIMARY KEY,
  listing_id       uuid        NOT NULL REFERENCES store.listings (id),
  merchant_id      uuid        NOT NULL,
  quantity         integer     NOT NULL CHECK (quantity > 0),
  requested_by     uuid        NOT NULL,
  reason           text,
  state            text        NOT NULL DEFAULT 'pending' CHECK (
    state IN ('pending', 'approved', 'rejected')),
  approved_by      uuid,
  decided_at       timestamptz,
  -- Set once Phase 9 actually mints the batch through 4.5's voucher-internal
  -- client. NULL until then, even for an approved request.
  minted_batch_id  uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),

  -- Same two-person shape `store.settlement_decrease_request` and
  -- `platform.region_setting` already use.
  CONSTRAINT voucher_batch_request_two_person CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CONSTRAINT voucher_batch_request_decision_consistency CHECK (
    (state = 'pending') = (approved_by IS NULL AND decided_at IS NULL))
);

CREATE INDEX voucher_batch_request_merchant_idx ON store.voucher_batch_request (merchant_id);
CREATE INDEX voucher_batch_request_listing_idx  ON store.voucher_batch_request (listing_id);

GRANT SELECT, INSERT, UPDATE ON store.voucher_batch_request TO yourtal_app;
