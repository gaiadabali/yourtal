-- 14.6.b: responsive posters. The sizes of a poster that were actually written
-- to the object store, as [{"url": "...", "width": 640}, ...], smallest first,
-- always including the card-size poster that poster_url points at. Empty means
-- "only poster_url", so a viewer is never sent a srcset candidate that is not
-- there. Recorded by the media pipeline and the staging backfill only after
-- each upload succeeds.

ALTER TABLE campaign.campaigns
  ADD COLUMN poster_variants jsonb NOT NULL DEFAULT '[]'
    CONSTRAINT campaigns_poster_variants_array CHECK (jsonb_typeof(poster_variants) = 'array');

-- The transcode worker reports its result here first; the ready callback copies
-- it to the campaign (7.2.b).
ALTER TABLE studio.media_assets
  ADD COLUMN poster_variants jsonb NOT NULL DEFAULT '[]'
    CONSTRAINT media_assets_poster_variants_array CHECK (jsonb_typeof(poster_variants) = 'array');
