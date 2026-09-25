-- 1.4.a: the first canonical per-account row in `identity` — everything
-- else in this schema (`credential`, `session`, `verification_token`,
-- `principal_security_state`) is keyed by the same free-text `user_id` with
-- no row that actually represents "the account". This is that row.
--
-- No FK anywhere: consistent with every other `identity.*`/`business.*`/
-- `ledger.*` table's own header on why `user_id` is a free-text opaque UUID
-- with no canonical users table backing it (see
-- 20260921180000_auth_credential_session_verification_token.sql).
--
-- `age_band` is deliberately NOT a column here — 1.4.a is explicit that it
-- is computed when read, from `date_of_birth`, never stored. A stored age
-- band is a derived value that drifts the moment a birthday passes without
-- a write to refresh it, the same class of bug docs/13 calls out for a
-- stored `is_expired` boolean instead of comparing a timestamp at read time.

CREATE TABLE identity.user_profile (
  user_id                text         PRIMARY KEY,

  -- F2's hard wall. Immutable after signup — enforced at the application
  -- layer (apps/api never issues an UPDATE touching this column), the same
  -- convention `campaign.campaigns.region` documents for itself in
  -- 20260925190000_campaign_listing_business_targeting_columns.sql, rather
  -- than a trigger: nothing here needs to survive a caller that is not
  -- `apps/api`'s own reviewed code.
  region                 text         NOT NULL CHECK (region IN ('AU', 'ID')),

  -- Independent of region (1.4.a) — a person's own display language choice,
  -- not their jurisdiction. Defaults to en-AU (0.5.a: English by default).
  display_locale         text         NOT NULL DEFAULT 'en-AU'
                         CHECK (display_locale IN ('en-AU', 'id-ID')),

  display_name           text         NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),

  date_of_birth          date         NOT NULL,

  -- The browser's IANA zone (e.g. "Australia/Sydney") at signup — used for
  -- F16's per-region streak clock and 12.3's teen quiet hours. Free text,
  -- not an enum: the IANA database has hundreds of zones and gains new ones
  -- over time, and validating format (rather than membership) is
  -- application code's job, not a CHECK constraint's.
  timezone               text         NOT NULL CHECK (char_length(timezone) > 0),

  -- NULL unless the account is 13-17 under TEEN_ACCOUNTS (1.4.b). Never
  -- populated for an adult account.
  guardian_email         text,

  -- 'not_required' for an adult account (the default); a teen account is
  -- created with 'pending' at registration (1.4.c) and moves to 'granted'
  -- once the guardian confirms — that confirmation flow is not built by
  -- 1.4, only the column it will write to.
  parent_consent_status  text         NOT NULL DEFAULT 'not_required'
                         CHECK (parent_consent_status IN ('not_required', 'pending', 'granted')),

  -- F12's holdback tiers. 0 is every new account's starting tier; nothing
  -- in 1.4 raises it — that is trust-tier promotion logic for a later task.
  trust_tier             smallint     NOT NULL DEFAULT 0 CHECK (trust_tier BETWEEN 0 AND 3),

  -- NULL means not suspended — the same "absence is the fact" convention
  -- `identity.principal_security_state.value_frozen_until` documents for
  -- itself, rather than a boolean that could disagree with a timestamp.
  suspended_at           timestamptz,

  created_at             timestamptz  NOT NULL DEFAULT now(),
  updated_at             timestamptz  NOT NULL DEFAULT now()
);

-- SELECT/INSERT/UPDATE for registration and PATCH /api/me (display name,
-- locale — never region, which the application never updates). DELETE for
-- 1.4.f's DSAR erasure handler, the same reason identity.session and
-- identity.verification_token already carry it: this table holds
-- erasable personal data, unlike the ledger/watch tables that cannot grant
-- DELETE at all.
GRANT SELECT, INSERT, UPDATE, DELETE ON identity.user_profile TO yourtal_app;
