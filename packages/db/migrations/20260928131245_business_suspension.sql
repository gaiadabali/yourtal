-- TASKS.md 9.3.a: staff suspension of a business. Add-only. A suspended
-- business's campaigns leave the feed (feed module, 9.3.b) and it cannot
-- submit or spend once 7.3 lands (⛔ 7.3, not built yet).
ALTER TABLE business.business_accounts ADD COLUMN suspended_at timestamptz;
ALTER TABLE business.business_accounts ADD COLUMN suspended_by_user_id text;
ALTER TABLE business.business_accounts ADD COLUMN suspended_reason text;

-- A reason with no timestamp, or a timestamp with no reason, is a row a
-- staff screen cannot explain -- same shape as `kyb_documents_verified_has_
-- reviewer` (20260919000003_business.sql).
ALTER TABLE business.business_accounts ADD CONSTRAINT business_suspended_has_reason CHECK (
  (suspended_at IS NULL) = (suspended_reason IS NULL)
);

CREATE INDEX business_accounts_suspended_idx ON business.business_accounts (id)
  WHERE suspended_at IS NOT NULL;
