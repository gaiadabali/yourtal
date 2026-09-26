-- 5.4/5.5 (TASKS.md): the viewer's own data that has no other home.
--
-- `identity.consent_record` stays in `identity` because it shapes
-- `@yourtal/consent`'s `consentRecordSchema` exactly and is per-account data
-- like `identity.user_profile`, not a `me`-module concept. Everything else
-- here — declared interests, follows, saves, a one-time linked-app code,
-- streak state and notifications — is new and gets its own schema.

-- ---------------------------------------------------------------------------
-- Consent: append-only, per @yourtal/consent's own doc comment. A withdrawal
-- is a NEW row, never an UPDATE to the old one — the evidence of what was
-- relied on at the time must survive the next toggle.
-- ---------------------------------------------------------------------------
CREATE TABLE identity.consent_record (
  id                 bigserial   PRIMARY KEY,
  user_id            text        NOT NULL,
  purpose            text        NOT NULL CHECK (char_length(purpose) > 0),
  jurisdiction       text        NOT NULL CHECK (jurisdiction IN ('AU', 'ID')),
  policy_version_id  text        NOT NULL,
  state              text        NOT NULL CHECK (state IN ('granted', 'withdrawn')),
  recorded_at        timestamptz NOT NULL DEFAULT now(),
  source             text        NOT NULL
);

-- The read side (`latestPerPurpose`) always wants "every record for this
-- user, newest first" or narrowed to one purpose — this index serves both.
CREATE INDEX consent_record_user_idx ON identity.consent_record (user_id, purpose, recorded_at DESC);

-- INSERT and SELECT only — no UPDATE, no DELETE. Matches
-- `watch.coverage`'s grant shape for the same reason: this is evidence a
-- lawful-basis determination is read against, and evidence that can be
-- edited after the fact is not evidence.
GRANT SELECT, INSERT ON identity.consent_record TO yourtal_app;
GRANT USAGE, SELECT ON SEQUENCE identity.consent_record_id_seq TO yourtal_app;

-- ---------------------------------------------------------------------------
-- me: declared interests, follows, saves, linked-app codes, streak state,
-- notifications. One Postgres schema per Nest module (docs/13b section 7).
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS me;

-- Declared only (1.1.e's taxonomy comment): a user opts into a node
-- themselves. Never derived from receipts or behaviour — that distinction is
-- what keeps this table out of the sensitive-inference red line.
CREATE TABLE me.interest (
  user_id    text        NOT NULL,
  node_id    text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, node_id)
);

-- A private ranking signal only (no user-to-user surface reads this).
CREATE TABLE me.follow (
  user_id     text        NOT NULL,
  business_id uuid        NOT NULL,
  region      text        NOT NULL CHECK (region IN ('AU', 'ID')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, business_id)
);

-- A private "watch later" list.
CREATE TABLE me.save (
  user_id     text        NOT NULL,
  campaign_id uuid        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, campaign_id)
);

-- 5.4.c: a one-time code the user copies into snap-app (8.4). Single-use and
-- short-lived; consuming it is snap-app's side, not built yet.
CREATE TABLE me.link_code (
  code        text        PRIMARY KEY,
  user_id     text        NOT NULL,
  region      text        NOT NULL CHECK (region IN ('AU', 'ID')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX link_code_user_idx ON me.link_code (user_id);

-- 5.5.a: one row per user. `current_length`/`last_counted_date` are the
-- streak itself; the two `*_granted` flags are the day-3/day-7 bonus's own
-- idempotency, reset whenever the streak breaks (application layer) so a
-- later streak can earn the bonus again.
CREATE TABLE me.streak_state (
  user_id           text        PRIMARY KEY,
  region            text        NOT NULL CHECK (region IN ('AU', 'ID')),
  current_length    integer     NOT NULL DEFAULT 0 CHECK (current_length >= 0),
  last_counted_date date,
  day3_granted      boolean     NOT NULL DEFAULT false,
  day7_granted      boolean     NOT NULL DEFAULT false,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- 5.5.b: `ledger.points_unlocked`, followed-channel campaigns, and (once
-- built) `ledger.points_expiring` all land here as one shape.
CREATE TABLE me.notification (
  id         bigserial   PRIMARY KEY,
  user_id    text        NOT NULL,
  region     text        NOT NULL CHECK (region IN ('AU', 'ID')),
  category   text        NOT NULL,
  title      text        NOT NULL,
  body       text        NOT NULL,
  metadata   jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz
);
CREATE INDEX notification_user_idx ON me.notification (user_id, created_at DESC);

CREATE TABLE me.notification_preference (
  user_id      text    NOT NULL,
  category     text    NOT NULL,
  push_enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, category)
);

GRANT USAGE ON SCHEMA me TO yourtal_app;
GRANT SELECT, INSERT, DELETE ON me.interest TO yourtal_app;
GRANT SELECT, INSERT, DELETE ON me.follow TO yourtal_app;
GRANT SELECT, INSERT, DELETE ON me.save TO yourtal_app;
GRANT SELECT, INSERT, UPDATE ON me.link_code TO yourtal_app;
GRANT SELECT, INSERT, UPDATE ON me.streak_state TO yourtal_app;
GRANT SELECT, INSERT, UPDATE ON me.notification TO yourtal_app;
GRANT SELECT, INSERT, UPDATE ON me.notification_preference TO yourtal_app;
GRANT USAGE, SELECT ON SEQUENCE me.notification_id_seq TO yourtal_app;
