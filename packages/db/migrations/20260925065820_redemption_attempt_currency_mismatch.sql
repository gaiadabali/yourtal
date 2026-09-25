-- services/voucher now refuses a redemption whose currency differs from the
-- voucher's with its own outcome. Without it in this CHECK, the attempt row
-- is refused and the audit log silently loses every such event.

ALTER TABLE voucher.redemption_attempt DROP CONSTRAINT redemption_attempt_outcome_check;
ALTER TABLE voucher.redemption_attempt
  ADD CONSTRAINT redemption_attempt_outcome_check CHECK (outcome IN (
    'authorized', 'unknown_code', 'wrong_merchant', 'insufficient_value',
    'inactive_voucher', 'policy_refused', 'killed', 'throttled', 'currency_mismatch'
  ));
