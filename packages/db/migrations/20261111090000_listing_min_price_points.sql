-- 2.8.g (F128): a listing can carry a staff-set points price. Checkout charges
-- max(min_price_points, the ledger's quote ceil(S / B)), so the price is never
-- below the backing: if B rises above it, the ledger's quote wins. The first
-- user is the "50 SnapApp scans" voucher at 200 points (the founder's decision
-- of 2026-10-22), where the points above S / B keep their backing in the
-- reserve. NULL, the default, is every listing today: nothing changes for them.
--
-- Set only by staff, through a two-person proposal (staff.economy_proposal,
-- kind 'listing_price'); a brand never sees or sets it.
--
-- Add-only: one nullable column with a CHECK every existing row satisfies, the
-- proposal kind added to its CHECK (dropped and re-added, as 20261020210034
-- did), and one partial unique index. Grants on store.listings and
-- staff.economy_proposal are table-level, so no GRANT changes. Rollback: drop
-- the index, restore the previous kind CHECK, drop the column.
ALTER TABLE store.listings
  ADD COLUMN min_price_points bigint
    CONSTRAINT listings_min_price_points_positive CHECK (min_price_points IS NULL OR min_price_points > 0);

ALTER TABLE staff.economy_proposal DROP CONSTRAINT economy_proposal_kind_check;
ALTER TABLE staff.economy_proposal ADD CONSTRAINT economy_proposal_kind_check
  CHECK (kind IN ('rate_change', 'fund_marketing', 'manual_purchase', 'setting_change',
                  'approve_payout', 'refund_purchase', 'retry_disbursement', 'listing_price'));

-- One open price proposal per listing, so two approvals never race.
CREATE UNIQUE INDEX economy_proposal_one_pending_listing_price
  ON staff.economy_proposal ((payload->>'listingId'))
  WHERE kind = 'listing_price' AND status = 'pending';
