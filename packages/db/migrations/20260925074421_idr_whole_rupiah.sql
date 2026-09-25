-- IDR moves from sen (exponent 2) to whole Rupiah (exponent 0), decision
-- T-1: the stored unit follows the payment gateway. This reverses
-- 20260920000011_idr_sen.sql. AUD does not move.
--
-- Every IDR amount must divide exactly by 100, or the migration refuses:
-- rounding would silently change what a balance, a voucher or a price is.
--
-- Not rescaled, on purpose:
--   voucher.event.detail is hash-chained; rewriting it would break the
--     chain. Amounts in events written before this migration are in sen.
--   voucher.redemption_attempt is a probe log with no currency column, so
--     its IDR rows cannot be told from AUD ones; its amount is informational.
-- ledger.daily_proof roots cover the rescaled entries, so they are dropped
-- and recomputed, as 20260920000011 did.

DO $$
DECLARE
  offenders bigint;
BEGIN
  SELECT
      (SELECT count(*) FROM store.listings WHERE currency = 'IDR' AND (
         face_value_minor % 100 <> 0 OR settlement_value_minor % 100 <> 0
         OR coalesce(minimum_spend_minor, 0) % 100 <> 0))
    + (SELECT count(*) FROM store.listing_price_revision WHERE currency = 'IDR' AND (
         previous_settlement_value_minor % 100 <> 0 OR new_settlement_value_minor % 100 <> 0))
    + (SELECT count(*) FROM store.settlement_decrease_request WHERE currency = 'IDR' AND (
         current_settlement_value_minor % 100 <> 0 OR proposed_settlement_value_minor % 100 <> 0))
    + (SELECT count(*) FROM voucher.vouchers WHERE currency = 'IDR' AND (
         face_value_minor % 100 <> 0 OR remaining_value_minor % 100 <> 0
         OR coalesce(minimum_spend_minor, 0) % 100 <> 0))
    + (SELECT count(*) FROM voucher.batch WHERE currency = 'IDR' AND (
         face_value_minor % 100 <> 0 OR settlement_value_minor % 100 <> 0
         OR coalesce(minimum_spend_minor, 0) % 100 <> 0))
    + (SELECT count(*) FROM voucher.authorization WHERE currency = 'IDR' AND amount_minor % 100 <> 0)
    + (SELECT count(*) FROM voucher.capture c JOIN voucher.authorization a ON a.id = c.authorization_id
        WHERE a.currency = 'IDR' AND (c.amount_minor % 100 <> 0 OR c.authorized_amount_minor % 100 <> 0))
    + (SELECT count(*) FROM voucher.refund r JOIN voucher.capture c ON c.id = r.capture_id
        JOIN voucher.authorization a ON a.id = c.authorization_id
        WHERE a.currency = 'IDR' AND r.amount_minor % 100 <> 0)
    + (SELECT count(*) FROM ledger.entry WHERE currency = 'IDR' AND amount_minor % 100 <> 0)
    + (SELECT count(*) FROM ledger.point_purchase WHERE currency = 'IDR' AND amount_minor % 100 <> 0)
    + (SELECT count(*) FROM ledger.backing_rate WHERE currency = 'IDR' AND (
         micros_per_point % 100 <> 0 OR issue_price_micros_per_point % 100 <> 0))
    INTO offenders;
  IF offenders > 0 THEN
    RAISE EXCEPTION
      'Refusing to move IDR to whole Rupiah: % row(s) hold a sen amount that is not a whole Rupiah. Converting them would round money. Fix or remove those rows, then re-run.',
      offenders;
  END IF;
END $$;

UPDATE store.listings
   SET face_value_minor       = face_value_minor / 100,
       settlement_value_minor = settlement_value_minor / 100,
       minimum_spend_minor    = minimum_spend_minor / 100
 WHERE currency = 'IDR';

UPDATE store.listing_price_revision
   SET previous_settlement_value_minor = previous_settlement_value_minor / 100,
       new_settlement_value_minor      = new_settlement_value_minor / 100
 WHERE currency = 'IDR';

UPDATE store.settlement_decrease_request
   SET current_settlement_value_minor  = current_settlement_value_minor / 100,
       proposed_settlement_value_minor = proposed_settlement_value_minor / 100
 WHERE currency = 'IDR';

UPDATE voucher.vouchers
   SET face_value_minor      = face_value_minor / 100,
       remaining_value_minor = remaining_value_minor / 100,
       minimum_spend_minor   = minimum_spend_minor / 100
 WHERE currency = 'IDR';

UPDATE voucher.batch
   SET face_value_minor       = face_value_minor / 100,
       settlement_value_minor = settlement_value_minor / 100,
       minimum_spend_minor    = minimum_spend_minor / 100
 WHERE currency = 'IDR';

UPDATE voucher.capture c
   SET amount_minor            = c.amount_minor / 100,
       authorized_amount_minor = c.authorized_amount_minor / 100
  FROM voucher.authorization a
 WHERE a.id = c.authorization_id AND a.currency = 'IDR';

UPDATE voucher.refund r
   SET amount_minor = r.amount_minor / 100
  FROM voucher.capture c
  JOIN voucher.authorization a ON a.id = c.authorization_id
 WHERE c.id = r.capture_id AND a.currency = 'IDR';

UPDATE voucher.authorization
   SET amount_minor = amount_minor / 100
 WHERE currency = 'IDR';

UPDATE ledger.entry
   SET amount_minor = amount_minor / 100
 WHERE currency = 'IDR';

UPDATE ledger.point_purchase
   SET amount_minor = amount_minor / 100
 WHERE currency = 'IDR';

-- Micros of the minor unit per point: B = IDR 6 is now 6_000_000.
UPDATE ledger.backing_rate
   SET micros_per_point             = micros_per_point / 100,
       issue_price_micros_per_point = issue_price_micros_per_point / 100
 WHERE currency = 'IDR';

DELETE FROM ledger.daily_proof;
