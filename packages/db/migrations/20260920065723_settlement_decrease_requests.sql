-- YT-0575: the workflow `approve_settlement_decrease` has needed since it was
-- named in `policies/resource_policies/listing.yaml` and
-- `packages/authz/src/resources.ts`. Until YT-0574 fixed
-- `merchandisers-run-inventory`'s fail-open condition, a material settlement
-- decrease was silently ALLOWED through `set_settlement_value` and this table
-- was never missed. Once that hole closes, a material decrease is correctly
-- REFUSED and has nowhere to go without this.
--
-- A request is recorded here as PENDING and applies nothing. A second
-- person's approval is what writes `store.listings.settlement_value_idr` and
-- `store.listing_price_revision` -- see
-- `apply-settlement-value-change.ts`, shared with the direct-apply
-- (non-material) path so there is exactly one place either kind of
-- settlement-value write happens.
CREATE TABLE store.settlement_decrease_request (
  id                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id                    uuid        NOT NULL REFERENCES store.listings (id),
  requested_by                  uuid        NOT NULL,
  -- Snapshot at proposal time, for audit/display. NOT re-checked at approval
  -- time against the listing's then-current value -- see the ticket report
  -- on why staleness handling is out of scope for this pass.
  current_settlement_value_idr  bigint      NOT NULL CHECK (current_settlement_value_idr >= 0),
  proposed_settlement_value_idr bigint      NOT NULL CHECK (proposed_settlement_value_idr >= 0),
  -- Unrepresentable rather than merely validated (docs/13c "make the bad
  -- state unrepresentable"): a row proposing an increase, or no change, is
  -- not a decrease request and this table cannot hold one.
  CONSTRAINT settlement_decrease_request_is_a_decrease
    CHECK (proposed_settlement_value_idr < current_settlement_value_idr),
  reason                        text,
  state                         text        NOT NULL DEFAULT 'pending'
                                             CHECK (state IN ('pending', 'approved')),
  approved_by                   uuid,
  approved_at                   timestamptz,
  -- Paired constraint (docs/13c "where safety lives in a pair, say so in
  -- both halves"): a pending row has no approver and no timestamp; an
  -- approved one has both. Deleting either half of this pair reopens a hole.
  CONSTRAINT settlement_decrease_request_approved_iff_state CHECK (
    (state = 'approved') = (approved_by IS NOT NULL AND approved_at IS NOT NULL)
  ),
  -- Belt-and-suspenders alongside the WHERE-clause enforcement in
  -- `DrizzleSettlementDecreaseRequestRepository.approve` (the actual
  -- control -- docs/13c "a WHERE clause protects the data"): even a bug in
  -- application code cannot commit a self-approved row past this CHECK.
  -- `approved_by IS NULL` must stay reachable -- it is the ordinary pending
  -- row, the same shape as the voucher-batch pairing docs/13c warns not to
  -- "fix" by dropping the NULL branch.
  CONSTRAINT settlement_decrease_request_no_self_approval CHECK (
    approved_by IS NULL OR approved_by <> requested_by
  ),
  created_at                    timestamptz NOT NULL DEFAULT now()
);

-- At most one PENDING request per listing at a time -- a second proposal
-- while one is outstanding is refused by this index, not merely by an
-- application-level check that runs first and can lose a race.
CREATE UNIQUE INDEX settlement_decrease_request_one_pending_uidx
  ON store.settlement_decrease_request (listing_id)
  WHERE state = 'pending';

CREATE INDEX settlement_decrease_request_listing_idx
  ON store.settlement_decrease_request (listing_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON store.settlement_decrease_request TO yourtal_app;

-- Links an audit row to the request it came from, so a reader of
-- `listing_price_revision` can tell a direct (non-material) edit apart from
-- an approved two-person request rather than only seeing the resulting
-- numbers. NULL for a direct edit -- the column existed with no such
-- distinction until now because YT-0575 is what first gave a revision row
-- a second possible origin.
ALTER TABLE store.listing_price_revision
  ADD COLUMN settlement_decrease_request_id uuid
    REFERENCES store.settlement_decrease_request (id);

CREATE INDEX listing_price_revision_request_idx
  ON store.listing_price_revision (settlement_decrease_request_id);
