-- TASKS.md 12.1.a: the guardian consent flow for a 13-17 account
-- (identity.user_profile.guardian_email/parent_consent_status, 1.4.b/1.4.c).
--
-- Two changes:
--
-- 1. `parent_consent_status` gains `revoked` (the shared contract with
--    Area B's `guardianConsent` principal attribute, phase12-common.md).
--    Widened the same way 20260929070000 widened
--    `listings_lifecycle_state_check` and 20260929071100 widened
--    `economy_proposal_kind_check`: drop and re-add, never edit in place.
--
-- 2. `identity.guardian_consent` -- one row per teen, created alongside the
--    profile at registration. Holds the HASHED token the guardian's email
--    carries (same sha256-of-a-CSPRNG-value convention as every other
--    bearer token in this schema, `auth/crypto/opaque-token.ts`) and the
--    approve/revoke history. The token is deliberately NOT single-use like
--    `identity.verification_token` -- 12.1.a's own spec is that "the same
--    link later revokes", so this table is a lookup keyed by a stable hash,
--    not a consume-once row.
--
-- No stored `status` column: `approved_at`/`revoked_at` are the facts
-- (absence is the fact, the same convention `identity.user_profile
-- .suspended_at`'s own header already documents for itself), and "pending /
-- granted / revoked" is derived from them at read time exactly the way
-- `age_band` is derived from `date_of_birth` rather than stored redundantly
-- alongside it. `guardian_confirmed_adult_at` is a separate fact from
-- `approved_at`: the guardian's 18-or-over confirmation is the input to the
-- approval, worth keeping distinct for an audit trail even though today
-- approval never happens without it.

ALTER TABLE identity.user_profile
  DROP CONSTRAINT user_profile_parent_consent_status_check;

ALTER TABLE identity.user_profile
  ADD CONSTRAINT user_profile_parent_consent_status_check
    CHECK (parent_consent_status IN ('not_required', 'pending', 'granted', 'revoked'));

CREATE TABLE identity.guardian_consent (
  -- One row per teen account -- identity.user_profile.user_id, no FK per
  -- this schema's own convention (see 20260921180000's header: no canonical
  -- users table to reference).
  user_id                      text        PRIMARY KEY,

  -- sha256 hex digest of the CSPRNG token the guardian email's links carry.
  -- Never the token itself -- see opaque-token.ts's own header for why a
  -- database read must not yield a usable credential. UNIQUE gives the
  -- lookup its index for free.
  token_hash                   text        NOT NULL UNIQUE,

  -- Captured at registration. Not re-read from user_profile on every
  -- request: a guardian's own email address is never the teen's, and F1.4.a
  -- already keeps guardian_email off the teen-facing profile contract, so
  -- this table is the one place it is read FROM for the guardian-facing
  -- page (GET /api/guardian/:token) -- 12.1.a's own instruction is that
  -- that response carries no email address at all, which is enforced at
  -- the controller/contract layer, not by hiding the column here.
  guardian_email                text        NOT NULL,

  -- F2's wall, restated for this table for the same reason
  -- campaign.campaigns.region documents for itself: never updated after
  -- creation.
  region                        text        NOT NULL CHECK (region IN ('AU', 'ID')),

  -- Set once, by the guardian confirming they are 18 or over at the same
  -- moment they approve (12.1.a: "the guardian confirms they are 18 or
  -- over and approves"). Kept distinct from approved_at even though they
  -- are set together today, because it records WHAT was confirmed, not
  -- just WHEN -- worth having for a legal review (12.4) that will ask
  -- exactly this question.
  guardian_confirmed_adult_at   timestamptz,
  approved_at                   timestamptz,

  -- Final for this link (12.1.a: "revoked is final for this link;
  -- re-approval is out of scope") -- there is no path back to NULL once set.
  revoked_at                    timestamptz,

  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),

  -- Never both -- a revoked link does not also carry a live approval.
  -- approve and revoke are exclusive outcomes of one row's lifetime.
  CONSTRAINT guardian_consent_not_both_approved_and_revoked CHECK (
    approved_at IS NULL OR revoked_at IS NULL
  ),
  -- guardian_confirmed_adult_at is the input approval is conditioned on --
  -- never set without it.
  CONSTRAINT guardian_consent_confirmed_adult_iff_approved CHECK (
    approved_at IS NULL OR guardian_confirmed_adult_at IS NOT NULL
  )
);

-- SELECT/INSERT for registration and the public GET/approve/revoke
-- endpoints; UPDATE for approve/revoke setting their timestamps. No DELETE:
-- this row is this account's only durable record of when and how consent
-- was granted or withdrawn, the same append-mostly reasoning
-- watch.coverage's own grant documents for itself -- an erasure handler
-- (1.4.f) is a later ticket's to extend, not this one's to pre-empt with a
-- grant nothing here yet uses.
GRANT SELECT, INSERT, UPDATE ON identity.guardian_consent TO yourtal_app;
