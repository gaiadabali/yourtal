-- YT-0540: email and password authentication. Three tables, added to the
-- `identity` schema `identity.principal_security_state`
-- (20260921130000_principal_security_state.sql) already created -- that
-- migration is NOT touched here, per this ticket's instructions.
--
-- ## Why `user_id` is an opaque UUID, minted at registration -- NOT the
-- email address
--
-- This migration originally made `user_id` BE the normalised email
-- address, on the reasoning that every other table with a `user_id`
-- column in this repo treats it as free text with no canonical identity
-- table backing it, and email is the one namespace unique without a
-- lookup table. That reasoning is recorded here, rewritten, because it
-- was wrong, and wrong for a reason worth keeping visible rather than
-- silently fixing:
--
-- `user_id` is the join key into stores whose own grants forbid removing
-- or rewriting a row: `ledger.account`, `ledger.transfer`, `ledger.entry`
-- and `ledger.grant` are `GRANT SELECT, INSERT` only (the ledger tables
-- additionally sealed daily by YT-0044's write-once Merkle root), and
-- `watch.coverage` is `GRANT SELECT, INSERT` only (append-only evidence a
-- reward is paid against, YT-0120). An email address stored as `user_id`
-- and threaded into any of those tables becomes UNERASABLE -- which
-- collides with YT-0528 (the remaining DSAR handlers) and YT-0036
-- (consent service) in the same epic. An erasure request cannot be
-- honoured against a store that has no DELETE grant and, for the ledger
-- tables, a published Merkle root over its exact contents.
--
-- The previous version of this file's header planned its own escape from
-- that: "if a canonical identity table is ever introduced, the migration
-- that adds it owns backfilling `user_id` away from email, in every table
-- that uses it." That plan cannot ever run. Backfilling `user_id` away
-- from email in `ledger.*` or `watch.coverage` is an UPDATE, and those
-- same grants that forbid DELETE forbid UPDATE too. The remedy the
-- original migration promised was, on its own terms, unreachable from the
-- day it was written -- visible only by checking the grants those tables
-- already carry, not by reading this migration in isolation.
--
-- Mundane and sufficient on its own even without any of the above: people
-- change their email address, and a value used as a join key across
-- several tables cannot be updated for the same reason a primary key
-- generally cannot -- every referencing row would need to move with it,
-- atomically, with no grant anywhere in this schema that permits it.
--
-- So: `user_id` is an opaque UUID, minted in application code
-- (`crypto.randomUUID()`, same as every other opaque identifier this
-- module already mints -- see `crypto/opaque-token.ts`) at registration,
-- and never derived from, or equal to, anything a person can change. It
-- joins `identity.credential`, `identity.session` and
-- `identity.verification_token` exactly as before; nothing about the
-- free-text `user_id` convention `business.business_members`,
-- `ledger.account`, etc. already use is disturbed, because none of them
-- reference this value or are referenced by it -- there is still no
-- canonical identity table, and this migration does not add one.
--
-- The one place email now lives is `identity.credential.identifier`,
-- added below, which is NOT the join key.

-- ---------------------------------------------------------------------------
-- identity.credential -- one row per credential kind, never a password
-- column on a user (there is no user row to put it on).
-- ---------------------------------------------------------------------------
CREATE TABLE identity.credential (
  -- Opaque, minted once at registration by the application
  -- (`crypto.randomUUID()`), never derived from `identifier`. Stored as
  -- `text`, matching the free-text `user_id` convention every other table
  -- in this schema already uses (`business.business_members`,
  -- `ledger.account`, ...) -- there is still no canonical identity table,
  -- and this is not one.
  user_id     text        NOT NULL,

  kind        text        NOT NULL,

  -- The credential kind's own namespace value: the normalised email for
  -- `kind = 'password'`; a phone number or an OIDC subject for a future
  -- kind (YT-0541's seam -- a new row, still not a migration). This is
  -- what a login looks up BY; `user_id` is what it returns.
  identifier  text        NOT NULL,

  -- Argon2id's own encoded output (algorithm, version, params, salt, hash
  -- all in one string) -- never a raw digest and never anything this schema
  -- has to know how to re-derive. Verifying is "ask the KDF", not "compare
  -- columns".
  secret_hash text        NOT NULL,

  updated_at  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, kind),

  -- Load-bearing, not incidental: this is what makes "this email is
  -- already registered" a UNIQUE violation on INSERT rather than a query
  -- against a table that does not exist -- the property the original
  -- version of this migration correctly wanted, preserved across the
  -- `user_id` rework above. Login is the one indirection this buys:
  -- look up by (kind, identifier) to get `user_id`, then verify the hash
  -- against that row.
  UNIQUE (kind, identifier)
);

-- ---------------------------------------------------------------------------
-- identity.session -- opaque CSPRNG session id, stored hashed.
-- ---------------------------------------------------------------------------
CREATE TABLE identity.session (
  -- The session id is a 256-bit CSPRNG token; what is stored here is its
  -- SHA-256 hex digest, never the token itself. Same reasoning
  -- `services/voucher/internal/redeem/redeem.go` already applies to voucher
  -- codes, restated for this table: a database read -- a backup, a replica,
  -- an operator's SELECT * -- must not yield a usable credential. The token
  -- has 256 bits of entropy generated server-side, so an UNKEYED hash is
  -- sufficient for the lookup; this is not a password, where a slow KDF and
  -- a per-secret salt earn their cost against a low-entropy input. See
  -- `apps/api/src/modules/auth/crypto/opaque-token.ts`.
  id                   text        PRIMARY KEY,

  -- The opaque UUID minted at registration -- see this file's header. NOT
  -- an email address; nothing in this table ever holds one.
  user_id              text        NOT NULL,

  created_at           timestamptz NOT NULL DEFAULT now(),

  -- Idle-timeout evidence. Touched on every authenticated request; idle
  -- expiry is a comparison against a policy constant in application code,
  -- never a stored `is_expired` -- see the note below.
  last_seen_at         timestamptz NOT NULL DEFAULT now(),

  -- The absolute lifetime ceiling, set once at issuance and never extended.
  -- Session validity is `revoked_at IS NULL AND absolute_expires_at > now()
  -- AND now() - last_seen_at < <idle window>` -- three comparisons against
  -- stored facts, not a fourth stored fact that could disagree with them.
  -- No `is_expired` column: docs/13's derived-value bug is exactly a
  -- boolean that has to be kept in step with a timestamp by something other
  -- than the read itself, and under concurrency the stored copy is the one
  -- that ends up wrong.
  absolute_expires_at  timestamptz NOT NULL,

  -- NULL means live. Set on logout and on rotation (YT-0540's "rotation on
  -- privilege change" -- every other session for a user_id is revoked when
  -- one is minted after a privilege-relevant event, e.g. a password
  -- change). No `is_locked`/`is_active` boolean alongside this for the same
  -- derived-value reason `absolute_expires_at` gets one instead of
  -- `is_expired`: NULL-or-not is the fact, not a flag that mirrors it.
  revoked_at           timestamptz
);

-- Rotation on privilege change is "revoke every live session for this
-- user_id", which without this index is a sequential scan of every session
-- in the system on every password change.
CREATE INDEX session_user_id ON identity.session (user_id);

-- ---------------------------------------------------------------------------
-- identity.verification_token -- password reset and email verification
-- share this table. `purpose` distinguishes them; `consumed_at`, not
-- deletion, is what makes each single-use.
-- ---------------------------------------------------------------------------
CREATE TABLE identity.verification_token (
  -- Same hashed-at-rest reasoning as `identity.session.id`: the raw token is
  -- what a reset-password email or a verification link carries, and a
  -- database read must not be able to reconstruct it.
  id           text        PRIMARY KEY,

  -- The opaque UUID minted at registration -- see this file's header. NOT
  -- an email address; nothing in this table ever holds one.
  user_id      text        NOT NULL,

  purpose      text        NOT NULL
                CHECK (purpose IN ('password_reset', 'email_verification')),

  expires_at   timestamptz NOT NULL,

  -- NULL until spent. This is the whole reason the table exists rather than
  -- a row that gets deleted on use: a DELETEd row and a row that never
  -- existed look identical to a second presentation of the same token, so
  -- neither could tell a replay apart from a forgery. Reading `consumed_at`
  -- IS NOT NULL first (already consumed) versus no row at all (never
  -- issued, or -- see pruning below -- pruned) keeps that distinction alive
  -- for as long as pruning allows it to be, and the pruning boundary is
  -- documented below rather than left to guesswork.
  consumed_at  timestamptz,

  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Issuing a new reset/verification token for a user looks up any currently
-- outstanding one of the same purpose; without this index that is a scan.
CREATE INDEX verification_token_user_purpose ON identity.verification_token (user_id, purpose);

-- ---------------------------------------------------------------------------
-- Grants -- yourtal_app, the unprivileged role every deployed process
-- connects as (YT-0554, risk 45).
-- ---------------------------------------------------------------------------

-- No DELETE on credential: rotating a password is `INSERT ... ON CONFLICT
-- (user_id, kind) DO UPDATE`, never a delete-then-insert. A credential row
-- for a kind the user still has should never disappear from underneath a
-- concurrent read; removing a credential kind entirely (turning password
-- auth off in favour of something else) is YT-0541's seam to build, not
-- this one's to grant a permission for today.
GRANT SELECT, INSERT, UPDATE ON identity.credential TO yourtal_app;

-- Session needs UPDATE (touching `last_seen_at`, setting `revoked_at`) and
-- DELETE (pruning past `absolute_expires_at`, scheduled, never on the
-- request path -- same split `watch.checkpoint_nonce` already makes between
-- its request-path grants and its own pruning DELETE).
GRANT SELECT, INSERT, UPDATE, DELETE ON identity.session TO yourtal_app;

-- Verification tokens need UPDATE (`consumed_at`) and DELETE for the same
-- scheduled-pruning reason as session -- but ONLY past `expires_at`, and
-- only alongside `consumed_at IS NOT NULL`, or a real replay could be
-- pruned into "never existed" before its expiry has actually passed.
-- Enforcing that boundary is the pruning job's contract, not this grant's;
-- the grant only says the column-level permission exists.
GRANT SELECT, INSERT, UPDATE, DELETE ON identity.verification_token TO yourtal_app;
