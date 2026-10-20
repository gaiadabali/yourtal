-- 5.2.c (F103, F106): a payout is never in flight unseen. The settlement job
-- reads back a payout that has had no webhook outcome for a few hours
-- (payout_checked_at throttles that read), and staff can check again or, when
-- the processor shows nothing moved, retry a row the job will not move by
-- itself (a transfer or payout left unconfirmed or refused): a new payout
-- attempt, never a second transfer. A retry is a two-person proposal in
-- staff.economy_proposal, one open per disbursement.
--
-- Only a column, a constraint and an index change on existing tables, so the
-- disbursement grants and region wall (20261020171300) cover them.

ALTER TABLE payment.disbursement ADD COLUMN payout_checked_at timestamptz;

ALTER TABLE staff.economy_proposal DROP CONSTRAINT economy_proposal_kind_check;
ALTER TABLE staff.economy_proposal ADD CONSTRAINT economy_proposal_kind_check
  CHECK (kind IN ('rate_change', 'fund_marketing', 'manual_purchase', 'setting_change',
                  'approve_payout', 'refund_purchase', 'retry_disbursement'));
CREATE UNIQUE INDEX economy_proposal_one_pending_retry
  ON staff.economy_proposal ((payload->>'disbursementId'))
  WHERE kind = 'retry_disbursement' AND status = 'pending';
