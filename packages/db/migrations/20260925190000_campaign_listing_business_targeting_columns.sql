-- TASKS.md 1.1: the shared columns B and C build the feed, studio and
-- campaign-authoring surfaces against before Phase 4 lands. Contracts and
-- this migration land in the same commit (1.1.g's Check).
--
-- Every new NOT NULL column below is added nullable first (or with a
-- placeholder DEFAULT), backfilled from whatever real data already implies
-- it, then locked down -- this repo's dev/staging data is real rows in
-- `campaign.campaigns`, `store.listings` and `business.business_accounts`
-- from earlier seeds, not an empty table, so "just add it NOT NULL" would
-- fail on every environment that has ever run `pnpm db:seed`. Placeholder
-- DEFAULTs are dropped once backfilled, so a future INSERT that forgets a
-- column fails loudly instead of silently picking up a stale placeholder.

-- ---------------------------------------------------------------------------
-- campaign.campaigns
-- ---------------------------------------------------------------------------

ALTER TABLE campaign.campaigns
  ADD COLUMN business_id           uuid,
  ADD COLUMN region                text,
  ADD COLUMN audience              text,
  ADD COLUMN content_category      text,
  ADD COLUMN poster_url            text,
  ADD COLUMN teaser_url            text,
  ADD COLUMN hls_url               text,
  -- Nullable for good: `null` means "no captions authored yet" (3.5.b),
  -- not a gap to backfill.
  ADD COLUMN captions_url          text,
  ADD COLUMN aspect                text,
  ADD COLUMN estimated_bytes       bigint,
  ADD COLUMN starts_at             timestamptz,
  ADD COLUMN ends_at               timestamptz,
  ADD COLUMN open_viewing          boolean NOT NULL DEFAULT false,
  ADD COLUMN teaser_start_seconds  integer NOT NULL DEFAULT 0;

-- A business account roster does not exist separately from the merchant
-- roster yet (that reconciliation is out of this task's scope) -- every
-- existing campaign's own merchant stands in as its business until one does.
UPDATE campaign.campaigns SET business_id = merchant_id WHERE business_id IS NULL;

-- Every campaign seeded to date is from the ID-only mock catalogue
-- (`packages/db/src/seed.ts` never seeds the AU mocks) -- see this
-- migration's header on why that makes 'ID' the correct backfill rather
-- than an arbitrary placeholder.
UPDATE campaign.campaigns SET region = 'ID' WHERE region IS NULL;
UPDATE campaign.campaigns SET audience = 'all_ages' WHERE audience IS NULL;
UPDATE campaign.campaigns SET content_category = 'food-and-drink' WHERE content_category IS NULL;
UPDATE campaign.campaigns SET aspect = '16:9' WHERE aspect IS NULL;

UPDATE campaign.campaigns
  SET poster_url = 'http://127.0.0.1:26900/yourtal-media/posters/placeholder.jpg'
  WHERE poster_url IS NULL;
UPDATE campaign.campaigns
  SET teaser_url = 'http://127.0.0.1:26900/yourtal-media/teasers/placeholder.mp4'
  WHERE teaser_url IS NULL;

-- The real value already exists, one join away -- every seeded campaign has
-- exactly one `campaign.video_source` row (campaignSchema requires it).
UPDATE campaign.campaigns c
  SET hls_url = vs.manifest_url
  FROM campaign.video_source vs
  WHERE vs.campaign_id = c.id AND c.hls_url IS NULL;
-- Anything still unmatched (a campaign whose video_source row is somehow
-- missing) falls back to the same placeholder family as poster/teaser above,
-- rather than leaving the backfill half-done.
UPDATE campaign.campaigns
  SET hls_url = 'http://127.0.0.1:26900/yourtal-media/hls/attention-30s/index.m3u8'
  WHERE hls_url IS NULL;

UPDATE campaign.campaigns
  SET estimated_bytes = round(estimated_data_mb * 1024 * 1024)::bigint
  WHERE estimated_bytes IS NULL;
UPDATE campaign.campaigns SET starts_at = published_at WHERE starts_at IS NULL;
UPDATE campaign.campaigns SET ends_at = published_at + interval '90 days' WHERE ends_at IS NULL;

ALTER TABLE campaign.campaigns
  ALTER COLUMN business_id      SET NOT NULL,
  ALTER COLUMN region           SET NOT NULL,
  ALTER COLUMN audience         SET NOT NULL,
  ALTER COLUMN content_category SET NOT NULL,
  ALTER COLUMN poster_url       SET NOT NULL,
  ALTER COLUMN teaser_url       SET NOT NULL,
  ALTER COLUMN hls_url          SET NOT NULL,
  ALTER COLUMN aspect           SET NOT NULL,
  ALTER COLUMN estimated_bytes  SET NOT NULL,
  ALTER COLUMN starts_at        SET NOT NULL,
  ALTER COLUMN ends_at          SET NOT NULL;

ALTER TABLE campaign.campaigns
  ADD CONSTRAINT campaigns_region_valid CHECK (region IN ('AU', 'ID')),
  ADD CONSTRAINT campaigns_audience_valid CHECK (
    audience IN ('all_ages', 'teen', 'adult', 'parents')
  ),
  ADD CONSTRAINT campaigns_content_category_valid CHECK (content_category IN (
    'food-and-drink', 'fashion', 'personal-care', 'electronics', 'telco', 'transport',
    'fitness', 'education', 'travel', 'home', 'entertainment', 'games', 'books',
    'family', 'toys', 'digital-goods', 'services',
    'tobacco', 'vaping', 'gambling', 'alcohol', 'dating', 'financial-products',
    'weight-loss', 'cosmetic-procedures', 'energy-drinks'
  )),
  ADD CONSTRAINT campaigns_aspect_valid CHECK (aspect IN ('16:9', '9:16')),
  ADD CONSTRAINT campaigns_ends_after_starts CHECK (ends_at > starts_at),
  ADD CONSTRAINT campaigns_teaser_start_before_end CHECK (teaser_start_seconds < duration_seconds),
  -- F10 (TASKS.md 1.1.f): a session never asks more than 5 questions. The
  -- existing `campaigns_question_count_check` only enforced >= 0.
  ADD CONSTRAINT campaigns_question_count_max CHECK (question_count <= 5);

-- `region` is immutable once set (businessSchema.region's own comment says
-- the same for the business it inherits from) -- enforced at the
-- application layer, the same way `campaign.terms_version` enforces "frozen"
-- by never being UPDATEd rather than by a database trigger.

CREATE INDEX campaigns_region_audience_idx ON campaign.campaigns (region, audience);

-- ---------------------------------------------------------------------------
-- campaign.terms_version: the accuracy bonus is reward-affecting too
-- ---------------------------------------------------------------------------

ALTER TABLE campaign.terms_version ADD COLUMN accuracy_bonus_points bigint;
UPDATE campaign.terms_version SET accuracy_bonus_points = 0 WHERE accuracy_bonus_points IS NULL;
ALTER TABLE campaign.terms_version
  ALTER COLUMN accuracy_bonus_points SET NOT NULL,
  ADD CONSTRAINT terms_version_accuracy_bonus_points_check CHECK (accuracy_bonus_points >= 0);

-- Tightened from BETWEEN 0 AND 20 to match F10's ceiling of 5 asked
-- questions per session (TASKS.md 1.1.f) -- see campaignTermsSchema's
-- questionCount for the Zod side of the same change.
ALTER TABLE campaign.terms_version DROP CONSTRAINT terms_version_question_count_check;
ALTER TABLE campaign.terms_version
  ADD CONSTRAINT terms_version_question_count_check CHECK (question_count BETWEEN 0 AND 5);

-- ---------------------------------------------------------------------------
-- campaign.question: when a question is eligible to be asked
-- ---------------------------------------------------------------------------

ALTER TABLE campaign.question
  ADD COLUMN answerable_after_seconds integer NOT NULL DEFAULT 0
    CHECK (answerable_after_seconds >= 0);

-- ---------------------------------------------------------------------------
-- store.listings
-- ---------------------------------------------------------------------------

ALTER TABLE store.listings
  ADD COLUMN region              text,
  ADD COLUMN audience            text,
  ADD COLUMN content_category    text,
  ADD COLUMN image_url           text,
  ADD COLUMN channel             text,
  ADD COLUMN partial_redemption  text;

-- Every listing seeded to date is from the ID-only mock catalogue, the same
-- as campaign.campaigns above.
UPDATE store.listings SET region = 'ID' WHERE region IS NULL;
UPDATE store.listings SET audience = 'all_ages' WHERE audience IS NULL;
UPDATE store.listings SET content_category = 'food-and-drink' WHERE content_category IS NULL;
UPDATE store.listings
  SET image_url = 'http://127.0.0.1:26900/yourtal-media/listings/placeholder.jpg'
  WHERE image_url IS NULL;
-- 'both' is the widest-reach backfill for a channel nobody recorded --
-- narrowing a listing's channel later is a merchant decision, not one this
-- migration should guess at.
UPDATE store.listings SET channel = 'both' WHERE channel IS NULL;
UPDATE store.listings SET partial_redemption = 'single_use' WHERE partial_redemption IS NULL;

ALTER TABLE store.listings
  ALTER COLUMN region             SET NOT NULL,
  ALTER COLUMN audience           SET NOT NULL,
  ALTER COLUMN content_category   SET NOT NULL,
  ALTER COLUMN image_url          SET NOT NULL,
  ALTER COLUMN channel            SET NOT NULL,
  ALTER COLUMN partial_redemption SET NOT NULL;

ALTER TABLE store.listings
  ADD CONSTRAINT listings_region_valid CHECK (region IN ('AU', 'ID')),
  ADD CONSTRAINT listings_audience_valid CHECK (
    audience IN ('all_ages', 'teen', 'adult', 'parents')
  ),
  ADD CONSTRAINT listings_content_category_valid CHECK (content_category IN (
    'food-and-drink', 'fashion', 'personal-care', 'electronics', 'telco', 'transport',
    'fitness', 'education', 'travel', 'home', 'entertainment', 'games', 'books',
    'family', 'toys', 'digital-goods', 'services',
    'tobacco', 'vaping', 'gambling', 'alcohol', 'dating', 'financial-products',
    'weight-loss', 'cosmetic-procedures', 'energy-drinks'
  )),
  ADD CONSTRAINT listings_channel_valid CHECK (channel IN ('in_store', 'online', 'both')),
  -- Deliberately a SECOND enum alongside partial_redemption_policy, not a
  -- replacement -- see listingSchema's `partialRedemptionSchema` comment for
  -- why (TASKS.md 1.1.a names both fields).
  ADD CONSTRAINT listings_partial_redemption_valid CHECK (
    partial_redemption IN ('single_use', 'balance_carries')
  );

CREATE INDEX listings_region_audience_idx ON store.listings (region, audience);

-- ---------------------------------------------------------------------------
-- business.business_accounts
-- ---------------------------------------------------------------------------

ALTER TABLE business.business_accounts
  ADD COLUMN region     text,
  ADD COLUMN currency   text,
  ADD COLUMN handle     text,
  ADD COLUMN cover_url  text;

-- Every business seeded to date is from business.mock.ts's Jakarta-flavoured
-- generator, which is ID-only today (an AU roster is C's to add, Phase 7).
UPDATE business.business_accounts SET region = 'ID' WHERE region IS NULL;
UPDATE business.business_accounts SET currency = 'IDR' WHERE currency IS NULL;
-- Derived from the row's own id so it is unique without inventing names --
-- the first 8 hex characters of a uuid's text form never contain a hyphen,
-- so this always satisfies businessHandleSchema's shape.
UPDATE business.business_accounts
  SET handle = 'business-' || substr(id::text, 1, 8)
  WHERE handle IS NULL;

ALTER TABLE business.business_accounts
  ALTER COLUMN region   SET NOT NULL,
  ALTER COLUMN currency SET NOT NULL,
  ALTER COLUMN handle   SET NOT NULL;

ALTER TABLE business.business_accounts
  ADD CONSTRAINT business_accounts_region_valid CHECK (region IN ('AU', 'ID')),
  ADD CONSTRAINT business_accounts_currency_valid CHECK (currency IN ('AUD', 'IDR')),
  -- The Zod-side refine, re-stated (F2: regions never cross). businessSchema
  -- rejects the same mismatch at the application boundary; this is the
  -- database's own copy of that rule, the same move campaignSchema's
  -- refinements get as CHECK constraints on campaign.campaigns.
  ADD CONSTRAINT business_accounts_currency_matches_region CHECK (
    (region = 'AU' AND currency = 'AUD') OR (region = 'ID' AND currency = 'IDR')
  ),
  ADD CONSTRAINT business_accounts_handle_shape CHECK (handle ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

CREATE UNIQUE INDEX business_accounts_handle_key ON business.business_accounts (handle);
