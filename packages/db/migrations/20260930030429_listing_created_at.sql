-- 13.12.b: the store's "newest" sort needs a creation time. Existing rows get
-- the migration's own time, so they tie and fall back to id order.
ALTER TABLE store.listings
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
