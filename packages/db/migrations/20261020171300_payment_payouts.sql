-- 5.2 / 14.8 (F103, F104, F106): payouts in Australia on Stripe Connect.
-- Brands and charities onboard a connected account; an approved settlement
-- statement becomes one transfer to the brand's account and a payout to its
-- bank. Indonesia has no real payouts (F104), so both tables are AU only.

-- One connected account per owner and provider. Only the bank's last four
-- digits are kept; the provider holds the rest.
CREATE TABLE payment.connected_account (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_kind        text        NOT NULL CHECK (owner_kind IN ('business', 'charity')),
  owner_id          uuid        NOT NULL,
  region            text        NOT NULL CHECK (region = 'AU'),
  provider          text        NOT NULL CHECK (provider IN ('stripe', 'simulated')),
  account_ref       text        NOT NULL UNIQUE,
  charges_enabled   boolean     NOT NULL DEFAULT false,
  payouts_enabled   boolean     NOT NULL DEFAULT false,
  details_submitted boolean     NOT NULL DEFAULT false,
  bank_last4        text        CHECK (bank_last4 ~ '^[0-9]{4}$'),
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- Moves on every account.updated: a failed payout is tried again only after it.
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_kind, owner_id, provider)
);

-- One row per approved statement, ever: the unique statement id is what keeps
-- the transfer to one per statement. The amount is copied from what the
-- approval stored. `attempt` names the payout key; it moves only after a
-- payout failed and the account was updated since.
CREATE TABLE payment.disbursement (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id          text        NOT NULL UNIQUE,
  proposal_id           uuid        NOT NULL REFERENCES staff.economy_proposal (id),
  business_id           uuid        NOT NULL,
  region                text        NOT NULL CHECK (region = 'AU'),
  currency              text        NOT NULL CHECK (currency = 'AUD'),
  amount_minor          bigint      NOT NULL CHECK (amount_minor > 0),
  account_ref           text,
  transfer_ref          text,
  payout_ref            text        UNIQUE,
  -- The bank the current payout was sent to, for "Paid to account ••3456".
  bank_last4            text        CHECK (bank_last4 ~ '^[0-9]{4}$'),
  status                text        NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued', 'awaiting_account', 'transferred', 'paid', 'failed')),
  failure_code          text,
  attempt               integer     NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  -- When the current transfer or payout key was first sent: an answer still
  -- unknown near the provider's 24 h idempotency window is not sent again.
  transfer_requested_at timestamptz,
  payout_requested_at   timestamptz,
  transferred_at        timestamptz,
  paid_at               timestamptz,
  failed_at             timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT disbursement_transferred_has_transfer CHECK (status NOT IN ('transferred', 'paid') OR transfer_ref IS NOT NULL),
  CONSTRAINT disbursement_paid_has_payout CHECK (status <> 'paid' OR (payout_ref IS NOT NULL AND paid_at IS NOT NULL)),
  CONSTRAINT disbursement_failed_has_code CHECK ((status = 'failed') = (failure_code IS NOT NULL)),
  CONSTRAINT disbursement_money_has_account CHECK (transfer_ref IS NULL OR account_ref IS NOT NULL)
);
CREATE INDEX disbursement_business_idx ON payment.disbursement (business_id, created_at DESC);
CREATE INDEX disbursement_open_idx ON payment.disbursement (created_at) WHERE status <> 'paid';

GRANT SELECT, INSERT, UPDATE ON payment.connected_account, payment.disbursement TO yourtal_app;

ALTER TABLE payment.connected_account ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON payment.connected_account
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE payment.disbursement ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON payment.disbursement
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));
