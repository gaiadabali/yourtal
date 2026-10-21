-- Group 3.9 (YourTal 14.16.a, docs/26 §5): YourTal as an OpenID Connect
-- provider for SnapApp and Free Tax Returns. The `oidc` schema follows the
-- docs/26 §5 sketch. No row here holds a YourTal user id outside YourTal: apps
-- only ever see the pairwise `sub` in oidc.subject.
CREATE SCHEMA IF NOT EXISTS oidc;

-- The provider's own records (oidc-provider's adapter): interactions, codes,
-- grants, sessions, client-credential tokens. `payload` is the library's JSON.
-- A row past `expires_at` is treated as absent; `consumed_at` marks a used code.
CREATE TABLE oidc.model (
  kind        text        NOT NULL,
  id          text        NOT NULL,
  payload     jsonb       NOT NULL,
  grant_id    text,
  uid         text,
  expires_at  timestamptz,
  consumed_at timestamptz,
  PRIMARY KEY (kind, id)
);
CREATE INDEX model_grant_idx ON oidc.model (grant_id) WHERE grant_id IS NOT NULL;
CREATE INDEX model_uid_idx ON oidc.model (kind, uid) WHERE uid IS NOT NULL;
CREATE INDEX model_expires_idx ON oidc.model (expires_at) WHERE expires_at IS NOT NULL;

-- One random sub per person per app (sector), made at first sign-in. Never
-- derived from user_id, so erasing the row erases the link for good.
CREATE TABLE oidc.subject (
  sector     text        NOT NULL,
  user_id    text        NOT NULL,
  sub        text        NOT NULL CHECK (char_length(sub) BETWEEN 1 AND 255),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sector, user_id),
  UNIQUE (sector, sub)
);

-- What a person shares with each app now. The evidence is in identity.consent_record.
CREATE TABLE oidc.app_consent (
  user_id           text        NOT NULL,
  sector            text        NOT NULL,
  scopes            text[]      NOT NULL,
  policy_version_id text        NOT NULL,
  granted_via       text        NOT NULL CHECK (granted_via IN ('consent_screen', 'guardian_invite')),
  invite_id         uuid,
  granted_at        timestamptz NOT NULL,
  ended_at          timestamptz,
  end_reason        text,
  PRIMARY KEY (user_id, sector)
);

-- A parent's invite for their teen into SnapApp (docs/26 §3.3). Filled by a
-- later ticket; the code is kept only as a hash.
CREATE TABLE oidc.teen_invite (
  id              uuid        PRIMARY KEY,
  sector          text        NOT NULL,
  code_hash       text        NOT NULL UNIQUE,
  inviter_user_id text        NOT NULL,
  region          text        NOT NULL CHECK (region IN ('AU', 'ID')),
  teen_user_id    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  accepted_at     timestamptz,
  ended_at        timestamptz,
  end_reason      text
);
CREATE INDEX teen_invite_inviter_idx ON oidc.teen_invite (inviter_user_id);

-- Signed events waiting for an app. Holds the app's sub and nothing else personal.
CREATE TABLE oidc.event_outbox (
  jti             uuid        PRIMARY KEY,
  client_id       text        NOT NULL,
  sub             text        NOT NULL,
  event_type      text        NOT NULL,
  payload         jsonb       NOT NULL,
  iat             timestamptz NOT NULL,
  attempts        int         NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz,
  failed_at       timestamptz,
  last_error      text
);
CREATE INDEX event_outbox_due_idx ON oidc.event_outbox (next_attempt_at)
  WHERE delivered_at IS NULL AND failed_at IS NULL;

-- One row per completed sign-in and per refusal, by client.
CREATE TABLE oidc.sign_in_log (
  id        bigserial   PRIMARY KEY,
  user_id   text        NOT NULL,
  client_id text        NOT NULL,
  result    text        NOT NULL,
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sign_in_log_user_idx ON oidc.sign_in_log (user_id);
CREATE INDEX sign_in_log_client_idx ON oidc.sign_in_log (client_id, at DESC);

-- The app a sister_app_profile_sharing record is about (its sector).
ALTER TABLE identity.consent_record ADD COLUMN audience text;

GRANT USAGE ON SCHEMA oidc TO yourtal_app;
-- The adapter writes, consumes and deletes its own records.
GRANT SELECT, INSERT, UPDATE, DELETE ON oidc.model TO yourtal_app;
-- A sub is never rewritten (no UPDATE). DELETE on this, app_consent, teen_invite
-- and sign_in_log is for the connected_apps erasure (docs/26 §2.6): every row
-- here is keyed by the one person being erased.
GRANT SELECT, INSERT, DELETE ON oidc.subject TO yourtal_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON oidc.app_consent TO yourtal_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON oidc.teen_invite TO yourtal_app;
-- The delivery job updates attempts and purges delivered rows after 30 days.
GRANT SELECT, INSERT, UPDATE, DELETE ON oidc.event_outbox TO yourtal_app;
GRANT SELECT, INSERT, DELETE ON oidc.sign_in_log TO yourtal_app;
GRANT USAGE, SELECT ON SEQUENCE oidc.sign_in_log_id_seq TO yourtal_app;

-- The region wall every region table carries (13.5.e, F92).
ALTER TABLE oidc.teen_invite ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON oidc.teen_invite
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));
