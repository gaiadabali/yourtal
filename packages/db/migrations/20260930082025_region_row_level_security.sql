-- 13.5.e (F29, F89): the region wall in Postgres. Every region-scoped table
-- gets row-level security keyed on `yourtal.region`, which the api sets per
-- connection checkout from a signed-in, non-staff principal, and the ledger
-- per acquire from the api's region header. Unset (anonymous, staff, jobs,
-- migrations) means no filter, so this narrows and never widens: a request
-- walled to one region cannot read or write the other's rows. NULL regions
-- (rows older than their region column) stay visible. The owner role that
-- runs migrations owns these tables and so is not subject to them.

ALTER TABLE business.business_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON business.business_accounts
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE campaign.campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON campaign.campaigns
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE checkout.saga ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON checkout.saga
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE identity.consent_record ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON identity.consent_record
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR jurisdiction IS NULL OR jurisdiction = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR jurisdiction IS NULL OR jurisdiction = current_setting('yourtal.region', true));

ALTER TABLE identity.guardian_consent ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON identity.guardian_consent
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE identity.user_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON identity.user_profile
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE ledger.account ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON ledger.account
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR country IS NULL OR country = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR country IS NULL OR country = current_setting('yourtal.region', true));

ALTER TABLE ledger.allocation ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON ledger.allocation
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE ledger.burn ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON ledger.burn
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE ledger.capture ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON ledger.capture
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE ledger.capture_recovery ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON ledger.capture_recovery
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE ledger.escrow ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON ledger.escrow
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE ledger."grant" ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON ledger."grant"
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE ledger.listing_price ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON ledger.listing_price
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE ledger.marketing_funding ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON ledger.marketing_funding
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE ledger.quote ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON ledger.quote
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE ledger.risk_flag ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON ledger.risk_flag
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE ledger.statement ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON ledger.statement
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE ledger.voucher_head_anchor ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON ledger.voucher_head_anchor
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE me.follow ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON me.follow
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE me.link_code ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON me.link_code
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE me.notification ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON me.notification
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE me.streak_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON me.streak_state
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE platform.ledger_fake_allocation ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON platform.ledger_fake_allocation
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE platform.ledger_fake_backing_rate ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON platform.ledger_fake_backing_rate
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE platform.ledger_fake_burn ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON platform.ledger_fake_burn
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE platform.ledger_fake_capture ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON platform.ledger_fake_capture
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE platform.ledger_fake_capture_recovery ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON platform.ledger_fake_capture_recovery
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE platform.ledger_fake_grant ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON platform.ledger_fake_grant
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE platform.ledger_fake_liability_release ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON platform.ledger_fake_liability_release
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE platform.ledger_fake_marketing_backing ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON platform.ledger_fake_marketing_backing
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE platform.ledger_fake_marketing_fund ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON platform.ledger_fake_marketing_fund
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE platform.ledger_fake_point_purchase ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON platform.ledger_fake_point_purchase
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE platform.ledger_fake_quote ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON platform.ledger_fake_quote
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE platform.ledger_fake_rate_proposal ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON platform.ledger_fake_rate_proposal
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE platform.ledger_fake_risk_flag ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON platform.ledger_fake_risk_flag
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE platform.ledger_fake_statement ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON platform.ledger_fake_statement
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE platform.region_setting ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON platform.region_setting
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE platform.sim_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON platform.sim_outbox
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE staff.audit_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON staff.audit_event
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE staff.economy_proposal ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON staff.economy_proposal
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE store.counter_device ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON store.counter_device
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE store.listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON store.listings
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE voucher.capture_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON voucher.capture_outbox
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE voucher.expiry_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON voucher.expiry_outbox
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE voucher.vouchers ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON voucher.vouchers
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE watch.open_view_session ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON watch.open_view_session
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));
