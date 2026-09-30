-- 13.11.a (F84): a listing's tags are up to 8 interest-taxonomy node ids.
-- The app validates each id against the taxonomy; the database keeps the shape.
ALTER TABLE store.listings
  ADD COLUMN tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT listings_tags_shape CHECK (
    jsonb_typeof(tags) = 'array' AND jsonb_array_length(tags) <= 8
  );
