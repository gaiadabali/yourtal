-- TASKS.md 10.6.a: payout approval reuses 9.5's own two-person bookkeeping
-- table (`staff.economy_proposal`, migration 20260929060100) rather than a
-- second proposal table -- "propose" records intent only (no ledger call,
-- same shape 9.5.c's marketing funding already uses), and "approve" is what
-- actually calls `ledger.approvePayout`, dual-approved the same way. Widen
-- the kind CHECK the same way 20260929070000 widened
-- `listings_lifecycle_state_check`: drop and re-add, never edit in place.
ALTER TABLE staff.economy_proposal
  DROP CONSTRAINT economy_proposal_kind_check;

ALTER TABLE staff.economy_proposal
  ADD CONSTRAINT economy_proposal_kind_check
    CHECK (kind IN ('rate_change', 'fund_marketing', 'manual_purchase', 'setting_change', 'approve_payout'));
