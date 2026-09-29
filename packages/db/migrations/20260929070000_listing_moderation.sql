-- TASKS.md 9.2.a: the listing half of the staff moderation queue.
--
-- 20260920040000_store_listing_management.sql's own header left this gap
-- deliberately open: "There is no 'draft' or 'pending_approval' state here:
-- a created listing is immediately 'active' ... this pass does not build
-- it -- see the ticket report." This migration is that build, kept
-- narrowly scoped: only a listing the automated screen flags (an
-- `adult_only` contentCategory, per 1.1.d) is ever created `pending_review`
-- -- every ordinary listing still goes straight to `active`, unchanged.
-- Nothing already in this table can retroactively become `pending_review`
-- (no backfill touches existing rows), so this cannot regress any
-- currently-live listing or any other test that assumes immediate `active`.
ALTER TABLE store.listings
  DROP CONSTRAINT listings_lifecycle_state_check;

ALTER TABLE store.listings
  ADD CONSTRAINT listings_lifecycle_state_check
    CHECK (lifecycle_state IN ('pending_review', 'active', 'rejected', 'paused', 'retired'));

-- Shown to the business the same way campaign.campaigns.rejection_reason is
-- shown to Studio (7.3's own column) -- null until a moderator rejects.
ALTER TABLE store.listings
  ADD COLUMN rejection_reason text;
