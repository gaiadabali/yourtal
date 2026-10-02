-- 13.9.c: a business's own .vtt, uploaded beside the video. Used for the
-- campaign's captions only when the video carries no subtitle stream.
ALTER TABLE studio.media_assets ADD COLUMN sidecar_captions_url text;
