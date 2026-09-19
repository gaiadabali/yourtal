-- YT-0506: IDR is stored in sen. Every stored Rupiah amount becomes 100x.
--
-- Settled by the founder on 2026-09-20. Sen is uncommon in daily use but
-- banking uses it — amounts appear as Rp 1.000,26 — which matches ISO 4217,
-- matches Stripe's treatment, and restores the original intent of docs/12,
-- docs/18 and YT-0041.
--
-- This migration is the 100x error that YT-0506 exists to prevent, performed
-- deliberately and once. Applied twice it silently multiplies by 10,000; not
-- applied at all it leaves every amount 100x too small. Both look identical
-- afterwards, because nothing in the data says which unit it is in. That is
-- the whole reason the ticket insisted this run as ONE unit of work with one
-- owner, alongside the contract, the mocks, the Go models and every consumer.
--
-- No explicit BEGIN/COMMIT: Atlas already runs each migration file in its own
-- transaction, and wrapping it again ends the file with the connection in an
-- unexpected state (`pq: unexpected transaction status idle`). The statements
-- below are still all-or-nothing — by Atlas, not by this file.

-- ---------------------------------------------------------------------------
-- The precondition, checked rather than assumed
-- ---------------------------------------------------------------------------
--
-- `store.listings` and `voucher.vouchers` have NO currency column. The
-- contract does not carry one either (YT-0513's wire migration is still
-- outstanding), so these tables are IDR-only by convention and nothing
-- enforces it.
--
-- That matters here more than anywhere else in the repo: the AU fixtures
-- store **AUD cents** in the very same `face_value_idr` column. If a single
-- AU row had been seeded, the unscoped UPDATE below would turn $12.50 into
-- $1,250 — silently, uniformly, and in exactly the direction this ticket
-- exists to prevent.
--
-- So the assumption is verified instead of trusted. These are the AU
-- merchants in `packages/contracts/src/merchant/merchant-roster.ts`; if any
-- of their rows exist, this migration refuses to run rather than corrupt
-- them, and whoever hits it needs a currency column before a unit change.
DO $$
DECLARE
  au_merchants uuid[] := ARRAY[
    '00000000-0000-4000-8000-000000000603',  -- Sydney CBD Cafe
    '00000000-0000-4000-8000-0000000006a1',  -- Wharf Espresso Co
    '00000000-0000-4000-8000-0000000006a2',  -- (long AU name)
    '00000000-0000-4000-8000-0000000006a3'   -- Cedar Deli Bar
  ]::uuid[];
  offenders bigint;
BEGIN
  SELECT (SELECT count(*) FROM store.listings   WHERE merchant_id = ANY(au_merchants))
       + (SELECT count(*) FROM voucher.vouchers WHERE merchant_id = ANY(au_merchants))
    INTO offenders;

  IF offenders > 0 THEN
    RAISE EXCEPTION
      'Refusing to scale IDR amounts: % row(s) belong to AU merchants, whose amounts are AUD cents, not Rupiah. These tables have no currency column (YT-0513), so this migration cannot tell them apart. Add the currency to the contract and the schema before changing a money unit.',
      offenders;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- The catalogue
-- ---------------------------------------------------------------------------
--
-- `price_in_points` is deliberately untouched: points are the platform's own
-- currency and YT-0506 says nothing about them. The mock backing rate moved
-- from 6 Rupiah to 600 sen per point in the same pass, so prices are
-- unchanged — which is the point. Both sides of `points_price = S / B` had
-- to move together or every price would be 100x wrong with nothing failing.

UPDATE store.listings
   SET face_value_idr       = face_value_idr * 100,
       settlement_value_idr = settlement_value_idr * 100,
       minimum_spend_idr    = minimum_spend_idr * 100;

UPDATE voucher.vouchers
   SET face_value_idr      = face_value_idr * 100,
       remaining_value_idr = remaining_value_idr * 100,
       minimum_spend_idr   = minimum_spend_idr * 100;

-- Both tables' CHECK constraints survive this by construction:
-- `settlement <= face` and `remaining <= face` are preserved under a common
-- positive factor, and `minimum_spend_idr` stays NULL where it was NULL, so
-- the `iff policy` biconditionals are untouched.

-- ---------------------------------------------------------------------------
-- The ledger
-- ---------------------------------------------------------------------------
--
-- Scoped by `currency`, which these tables DO carry. That is not a detail:
-- `ledger.entry` also holds YTP point entries, and an unscoped update here
-- would multiply every user's points balance by 100. The catalogue tables
-- above needed a hand-written guard for exactly the reason these two do not.

UPDATE ledger.entry
   SET amount_minor = amount_minor * 100
 WHERE currency = 'IDR';

UPDATE ledger.point_purchase
   SET amount_minor = amount_minor * 100
 WHERE currency = 'IDR';

-- The deferred balance trigger re-checks at COMMIT and still passes: a
-- transfer whose entries summed to zero sums to zero after both sides are
-- multiplied by the same factor.

-- ---------------------------------------------------------------------------
-- The daily proofs are now wrong, and that is the proof system working
-- ---------------------------------------------------------------------------
--
-- `ledger.daily_proof` stores a Merkle root over each day's entries,
-- including `amount_minor`. Rewriting those amounts means every recorded
-- root no longer matches its day — and `proof.VerifyDay` would report
-- "the count is unchanged, so an existing row was ALTERED", which is
-- precisely what it is for and precisely what just happened.
--
-- Leaving them would page a human at 3am about a change we made on purpose,
-- and a checker that cries wolf once gets muted. So the superseded proofs
-- are removed here, deliberately, as part of the same transaction that
-- invalidated them.
--
-- The table grants `yourtal_ledger` INSERT and SELECT only, so it cannot do
-- this to itself: a rewrite of proved history requires the schema owner and
-- a migration, which is the correct amount of ceremony. In production this
-- would be a signed re-baselining with the old roots archived first, not a
-- DELETE — recorded in YT-0506 rather than left as a silence here.
DELETE FROM ledger.daily_proof;
