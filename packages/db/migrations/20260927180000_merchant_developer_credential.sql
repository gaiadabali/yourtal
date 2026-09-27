-- TASKS.md 8.3.a: Studio -> Developers. The voucher service's own merchant
-- credential (services/voucher/internal/api/credential_routes.go) tracks
-- only merchantId/deviceId/issuedBy/state -- no label and no sandbox flag,
-- because it has no concept of "a business's own developer page". This
-- table is that page's own index: which credentials belong to which
-- business, under what label, and whether it is the one free sandbox
-- credential every business gets at KYB. The voucher service stays the
-- source of truth for the credential's OWN state (active/revoked); this
-- table's own `state` is a cache of that, updated at rotate/revoke time,
-- never the other way around.

CREATE TABLE business.merchant_developer_credential (
  credential_id  text        PRIMARY KEY,
  business_id    uuid        NOT NULL REFERENCES business.business_accounts (id),
  label          text        NOT NULL,
  sandbox        boolean     NOT NULL DEFAULT true,
  state          text        NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'revoked')),
  issued_by      text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX merchant_developer_credential_business_idx
  ON business.merchant_developer_credential (business_id);

GRANT SELECT, INSERT, UPDATE ON business.merchant_developer_credential TO yourtal_app;
