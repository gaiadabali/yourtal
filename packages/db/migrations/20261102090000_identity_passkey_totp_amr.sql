-- Passkeys, authenticator-app codes, and how each session was signed in to.
-- Add-only: one new table, three new columns, one grant.
--
-- identity.credential stays one row per (user_id, kind), and gains two kinds
-- with no DDL, since `kind` is free text:
--
--   * 'totp': identifier = user_id, secret_hash = the authenticator seed
--     sealed with AES-256-GCM under TOTP_SECRET_ENCRYPTION_KEY (a seed must be
--     recoverable to check a code, so it cannot be hashed), and verified_at =
--     when the person confirmed it with a first code. An unfinished
--     enrolment lives only in Valkey, so every 'totp' row is switched on.
--   * 'passkey': one row per account that has passkeys, written with its
--     first passkey. identifier = the WebAuthn user handle (random, so the
--     authenticator never holds the user id), secret_hash = '' (the public
--     keys live below).
--
-- Each passkey is a row in identity.passkey, tied to that 'passkey' row by a
-- foreign key with ON DELETE CASCADE. Account deletion already erases every
-- identity.credential row of the subject (packages/db/src/dsar-handlers.ts,
-- eraseCredentials), and the cascade takes the passkeys with it, so the
-- deletion path needs no change. The cascade runs as the owner of
-- identity.passkey, not as yourtal_app.

CREATE TABLE identity.passkey (
  -- The WebAuthn credential id, base64url. What a sign-in looks up by.
  credential_id  text        PRIMARY KEY,
  user_id        text        NOT NULL,
  -- Constant, so the foreign key below can name the 'passkey' credential row.
  kind           text        NOT NULL DEFAULT 'passkey' CHECK (kind = 'passkey'),
  -- COSE public key. Public by nature: a dump of it signs nothing.
  public_key     bytea       NOT NULL,
  -- The authenticator's signature counter. Many passkeys always report 0; a
  -- non-zero counter that fails to grow is refused as a possible clone.
  sign_count     bigint      NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
  transports     text[]      NOT NULL DEFAULT '{}',
  device_type    text        NOT NULL CHECK (device_type IN ('singleDevice', 'multiDevice')),
  backed_up      boolean     NOT NULL,
  -- One printable line: it is shown in Me and written into security emails.
  -- The same characters the contract refuses (Unicode Cc, Cf, Zl, Zp as of
  -- Unicode 15.1): control characters (C0, DEL, C1), line and paragraph
  -- separators, and invisible format characters such as bidi overrides and
  -- the tag characters outside the BMP.
  name           text        NOT NULL CHECK (
    char_length(name) BETWEEN 1 AND 64
    AND name !~ '[\x01-\x1f\x7f-\x9f\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]'
  ),
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz,
  FOREIGN KEY (user_id, kind) REFERENCES identity.credential (user_id, kind) ON DELETE CASCADE
);

CREATE INDEX passkey_user_id ON identity.passkey (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON identity.passkey TO yourtal_app;

-- How the session was signed in to, as OIDC `amr` values: pwd (password),
-- hwk (passkey), otp (authenticator code), mfa (two factors). Every session
-- before this column was minted after a password, hence the default; the app
-- always sets it explicitly.
ALTER TABLE identity.session
  ADD COLUMN amr text[] NOT NULL DEFAULT '{pwd}'
    CHECK (cardinality(amr) > 0 AND amr <@ ARRAY['pwd', 'hwk', 'otp', 'mfa']::text[]);

-- When the person last proved who they are (OIDC `auth_time`). Starts as the
-- session's creation, but a session minted to replace another (a password
-- change) keeps the original's, so a replacement never counts as a fresh
-- sign-in.
ALTER TABLE identity.session ADD COLUMN signed_in_at timestamptz;
UPDATE identity.session SET signed_in_at = created_at;
ALTER TABLE identity.session
  ALTER COLUMN signed_in_at SET DEFAULT now(),
  ALTER COLUMN signed_in_at SET NOT NULL;

-- The account's factor window (on its 'password' row, one per account). When
-- an account with no passkey and no authenticator app gets its first one
-- from a session signed in with a password alone, this is set to 72 hours
-- later; more factors added meanwhile do not move it, and it is cleared when
-- the account has no factor left. While it is open, a password reset (which
-- proves the mailbox) removes every passkey and app and ends every session,
-- so a factor planted with a phished password, and anything added with it,
-- comes off. NULL: closed.
ALTER TABLE identity.credential ADD COLUMN factors_open_until timestamptz;
