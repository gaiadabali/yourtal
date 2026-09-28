-- TASKS.md 9.5.b/9.5.c: a staff-owned read model for "what economy action is
-- awaiting a second approver". Rate changes and region settings already have
-- their own authoritative propose/approve rows (`platform.ledger_fake_rate_proposal`,
-- `platform.region_setting`) -- this table does NOT replace either as the
-- source of truth for "is this approved"; `ledger-internal`'s own two-person
-- checks (the DB trigger + Cerbos) still decide that. What `ledger-internal`
-- exposes no way to do is LIST what is still pending, for a second staff
-- member to find and act on, and marketing funding / a manual point purchase
-- have no propose-only step in `ledger-internal` at all (`fundMarketing`
-- takes proposedBy AND approvedBy in one call; there is no `purchasePoints`
-- equivalent of `proposeRate`). So this table is where the FIRST staff
-- member's action is recorded, for every one of 9.5's four two-person flows,
-- and the SECOND staff member's approval is what actually calls the ledger.
--
-- Same shape as `platform.region_setting` and `platform.ledger_fake_rate_proposal`
-- (whose own two-person CHECKs this mirrors): one row per proposal, decided
-- in place, never a separate approval table.
CREATE TABLE staff.economy_proposal (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text        NOT NULL
    CHECK (kind IN ('rate_change', 'fund_marketing', 'manual_purchase', 'setting_change')),
  region        text        NOT NULL CHECK (region IN ('AU', 'ID')),
  summary       text        NOT NULL,
  -- The exact request this proposal will issue to ledger-internal at
  -- approval time (kind-dependent shape; the API, not the database, owns
  -- validating it). For `rate_change`/`setting_change`, also holds the
  -- ledger's own id (`ledgerRef`) once `proposeRate`/`proposeSetting` has
  -- returned it, so approval knows what to call `approveRate`/`approveSetting`
  -- with.
  payload       jsonb       NOT NULL,
  -- The ledger's own response once this proposal has been executed
  -- (approved), for the UI to show without a second round trip.
  result        jsonb,
  proposed_by   text        NOT NULL,
  approved_by   text,
  status        text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reason        text,
  decision_note text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz,

  -- F23's two-person rule, the same belt-and-braces the ledger's own tables
  -- carry: the API and Cerbos both already refuse a self-approval, and this
  -- CHECK means a bug in either could not still write one here.
  CONSTRAINT economy_proposal_two_person CHECK (approved_by IS NULL OR approved_by <> proposed_by),
  CONSTRAINT economy_proposal_decision_consistency CHECK ((status = 'pending') = (decided_at IS NULL)),
  CONSTRAINT economy_proposal_approved_by_only_when_approved
    CHECK ((status = 'approved') = (approved_by IS NOT NULL))
);

CREATE INDEX economy_proposal_region_status_idx
  ON staff.economy_proposal (region, kind, status, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON staff.economy_proposal TO yourtal_app;
REVOKE DELETE ON staff.economy_proposal FROM yourtal_app;
