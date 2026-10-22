-- 2.8 T1 (group plan): a listing can be BOUND to a partner app, so only the
-- partner's linked account may redeem its vouchers (e.g. "swap a YourTal
-- voucher for SnapApp scans"). NULL, the default, is every listing that exists
-- today and every ordinary listing after it: nothing about them changes.
--
-- A bound voucher is spent by the partner, online, against one linked account,
-- so the shape is fixed in the database and not left to the service layer:
--   * channel = 'online'                     (never redeemed at a counter)
--   * transferable = false                   (the linked account is the holder)
--   * partial_redemption_policy = 'single_use_forfeit' and
--     partial_redemption = 'single_use'      (no balance to carry or top up)
-- Both partial-redemption columns are pinned: they are the fine and the coarse
-- spelling of the same rule (see 20260925190000) and must not disagree.
--
-- Add-only: one nullable column, one CHECK that every existing row satisfies
-- (they are all NULL), one partial index. No backfill, no lock beyond the
-- brief table-level ones ALTER takes. The grants on store.listings are
-- table-level, so the new column is covered with no GRANT change.
-- Rollback: DROP INDEX, DROP CONSTRAINT, DROP COLUMN (no data depends on it
-- until the bind endpoint, a later ticket, writes the first value).
ALTER TABLE store.listings
  ADD COLUMN redeem_partner_id text REFERENCES platform.partner_credential (partner_id);

ALTER TABLE store.listings
  ADD CONSTRAINT listings_bound_partner_shape CHECK (
    redeem_partner_id IS NULL
    OR (
      channel = 'online'
      AND transferable = false
      AND partial_redemption_policy = 'single_use_forfeit'
      AND partial_redemption = 'single_use'
    )
  );

CREATE INDEX listings_redeem_partner_idx
  ON store.listings (redeem_partner_id)
  WHERE redeem_partner_id IS NOT NULL;
