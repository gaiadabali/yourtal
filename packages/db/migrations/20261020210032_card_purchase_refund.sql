-- 5.1.g (F123): a paid card purchase the ledger would not turn into points
-- (`needs_review`) is settled by refunding the card in full through the
-- processor, with two-person approval; the brand buys again at today's price.
--
-- The refund is claimed on the purchase BEFORE the processor is called
-- (refund_proposal_id and refund_requested_by, the approving staff member), so
-- a crash after the call is retried under the same proposal and the same
-- idempotency key, and a second proposal can never also refund it. The
-- refund.succeeded webhook and the approving request both settle it; whichever
-- runs second finds it done. `refunded` keeps review_reason, so the queue still
-- says why it was parked.
--
-- Only columns, constraints and indexes change on existing tables, so their
-- grants and region wall (20261020161813) cover them; nothing is added.

ALTER TABLE payment.card_purchase
  ADD COLUMN refund_proposal_id  uuid REFERENCES staff.economy_proposal (id),
  ADD COLUMN refund_requested_by text,
  ADD COLUMN refund_ref          text,
  ADD COLUMN refunded_at         timestamptz;

-- New constraints, never an edit of the old ones: drop and re-add, as
-- 20260929071100 did for economy_proposal_kind_check.
ALTER TABLE payment.card_purchase DROP CONSTRAINT card_purchase_status_check;
ALTER TABLE payment.card_purchase ADD CONSTRAINT card_purchase_status_check
  CHECK (status IN ('pending', 'paid', 'expired', 'needs_review', 'refunded'));

ALTER TABLE payment.card_purchase DROP CONSTRAINT card_purchase_review_has_reason;
ALTER TABLE payment.card_purchase ADD CONSTRAINT card_purchase_review_has_reason
  CHECK ((status IN ('needs_review', 'refunded')) = (review_reason IS NOT NULL));

ALTER TABLE payment.card_purchase ADD CONSTRAINT card_purchase_refunded_has_refund
  CHECK (status <> 'refunded'
         OR (refunded_at IS NOT NULL AND refund_ref IS NOT NULL AND payment_ref IS NOT NULL));
ALTER TABLE payment.card_purchase ADD CONSTRAINT card_purchase_refund_only_when_parked
  CHECK (refund_proposal_id IS NULL OR status IN ('needs_review', 'refunded'));
ALTER TABLE payment.card_purchase ADD CONSTRAINT card_purchase_refund_claim_has_proposal
  CHECK (refund_requested_by IS NULL OR refund_proposal_id IS NOT NULL);

-- One refund per proposal and per processor refund: the money moves once.
CREATE UNIQUE INDEX card_purchase_refund_proposal_idx
  ON payment.card_purchase (refund_proposal_id) WHERE refund_proposal_id IS NOT NULL;
CREATE UNIQUE INDEX card_purchase_refund_ref_idx
  ON payment.card_purchase (refund_ref) WHERE refund_ref IS NOT NULL;
CREATE INDEX card_purchase_refunded_idx
  ON payment.card_purchase (region, refunded_at DESC) WHERE status = 'refunded';

-- The refund is a two-person proposal in staff.economy_proposal, like every
-- staff money action. Only one may be open per purchase.
ALTER TABLE staff.economy_proposal DROP CONSTRAINT economy_proposal_kind_check;
ALTER TABLE staff.economy_proposal ADD CONSTRAINT economy_proposal_kind_check
  CHECK (kind IN ('rate_change', 'fund_marketing', 'manual_purchase', 'setting_change',
                  'approve_payout', 'refund_purchase'));
CREATE UNIQUE INDEX economy_proposal_one_pending_refund
  ON staff.economy_proposal ((payload->>'purchaseId'))
  WHERE kind = 'refund_purchase' AND status = 'pending';
