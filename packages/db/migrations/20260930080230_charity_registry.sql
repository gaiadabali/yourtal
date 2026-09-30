-- 13.21.a (F86): the charity registry. A charity is region-scoped (F2) and
-- is paid straight into its own account at the payment provider: YourTal
-- stores the provider's payout reference and the last four digits, never an
-- account number, and holds no charity balance (red line 8).

CREATE SCHEMA IF NOT EXISTS charity;
GRANT USAGE ON SCHEMA charity TO yourtal_app;

CREATE TABLE charity.charity (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  region               text        NOT NULL CHECK (region IN ('AU', 'ID')),
  name                 text        NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  cause                text        NOT NULL CHECK (cause IN ('children_youth', 'education',
                         'environment', 'animals', 'disaster_relief', 'community',
                         'arts_culture', 'food_security')),
  summary              text        NOT NULL,
  logo_url             text,
  registration         jsonb       NOT NULL,
  payout_account_name  text        NOT NULL,
  payout_account_last4 text        NOT NULL CHECK (payout_account_last4 ~ '^[0-9]{4}$'),
  -- The simulated KYB check's references: one for the registration, one for
  -- the provider-held payout account that auction captures settle into.
  kyb_reference        text        NOT NULL,
  payout_reference     text        NOT NULL,
  state                text        NOT NULL DEFAULT 'pending'
                         CHECK (state IN ('pending', 'approved', 'rejected')),
  rejection_reason     text,
  applied_by           text        NOT NULL,
  applied_at           timestamptz NOT NULL DEFAULT now(),
  decided_by           text,
  decided_at           timestamptz,
  -- AU registers with the ACNC; ID is a yayasan (the region wall, in the row).
  CONSTRAINT charity_registration_matches_region CHECK (
    (region = 'AU') = (registration->>'kind' = 'au_acnc')
  ),
  CONSTRAINT charity_decision_consistency CHECK (
    (state = 'pending') = (decided_at IS NULL) AND
    (state = 'rejected') = (rejection_reason IS NOT NULL)
  )
);
CREATE INDEX charity_region_state_idx ON charity.charity (region, state);

-- Who administers a charity: the applicant, once approved (the charity_admin role).
CREATE TABLE charity.member (
  charity_id uuid        NOT NULL REFERENCES charity.charity (id),
  user_id    text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (charity_id, user_id)
);

-- Every staff decision, append-only: the audit trail for approve and reject.
CREATE TABLE charity.decision (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  charity_id uuid        NOT NULL REFERENCES charity.charity (id),
  staff_user text        NOT NULL,
  decision   text        NOT NULL CHECK (decision IN ('approve', 'reject')),
  reason     text        NOT NULL CHECK (length(reason) >= 3),
  decided_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON charity.charity TO yourtal_app;
GRANT SELECT, INSERT ON charity.member, charity.decision TO yourtal_app;
REVOKE UPDATE, DELETE ON charity.decision FROM yourtal_app;
