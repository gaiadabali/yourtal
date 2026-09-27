-- TASKS.md 7.2: the media pipeline. One row per uploaded video, tracking it
-- from the presigned multipart PUT (`raw/...`) through the worker's
-- transcode to the renditions a campaign actually serves.
--
-- `campaign_id` is set at initiate time: a business uploads media FOR a
-- campaign draft it already created (7.3), never a freestanding asset with
-- nowhere to attach. The worker never writes `campaign.campaigns` itself
-- (TASKS.md is explicit); this table is what it writes instead, and the
-- studio module's `/internal/.../ready` callback copies the result across.

CREATE SCHEMA IF NOT EXISTS studio;
GRANT USAGE ON SCHEMA studio TO yourtal_app;

CREATE TABLE studio.media_assets (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid        NOT NULL REFERENCES business.business_accounts (id),
  campaign_id        uuid        NOT NULL REFERENCES campaign.campaigns (id),
  status             text        NOT NULL DEFAULT 'uploading'
                       CHECK (status IN ('uploading', 'queued', 'processing', 'ready', 'failed')),
  content_type       text        NOT NULL,
  size_bytes         bigint      NOT NULL CHECK (size_bytes > 0),
  raw_object_key     text        NOT NULL,
  upload_id          text        NOT NULL,
  teaser_start_seconds integer   NOT NULL DEFAULT 0,
  duration_seconds   integer,
  aspect             text,
  poster_url         text,
  teaser_url         text,
  hls_url            text,
  captions_url       text,
  -- Bytes per rendition (360p/540p/720p); 540p is what `estimatedBytes`
  -- (campaign.campaigns) is defined against (TASKS.md 7.2.b).
  rendition_bytes    jsonb,
  failure_reason     text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT media_assets_ready_has_renditions CHECK (
    status != 'ready' OR (poster_url IS NOT NULL AND teaser_url IS NOT NULL AND hls_url IS NOT NULL)
  ),
  CONSTRAINT media_assets_failed_has_reason CHECK (
    status != 'failed' OR failure_reason IS NOT NULL
  )
);

CREATE INDEX media_assets_business_idx ON studio.media_assets (business_id);
CREATE INDEX media_assets_campaign_idx ON studio.media_assets (campaign_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON studio.media_assets TO yourtal_app;
