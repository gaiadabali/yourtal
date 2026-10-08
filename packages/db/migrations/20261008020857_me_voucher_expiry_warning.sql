-- 13.3.i: one warning per voucher, ever. The daily worker job claims a voucher
-- here and writes its in-app notification in the same statement, so a re-run,
-- a retry or a second worker cannot warn twice. The primary key is the claim.
CREATE TABLE me.voucher_expiry_warning (
  voucher_id uuid        PRIMARY KEY,
  user_id    text        NOT NULL,
  region     text        NOT NULL CHECK (region IN ('AU', 'ID')),
  expires_at timestamptz NOT NULL,
  warned_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX voucher_expiry_warning_user_idx ON me.voucher_expiry_warning (user_id);

GRANT SELECT, INSERT ON me.voucher_expiry_warning TO yourtal_app;

-- The region wall every region table carries (13.5.e).
ALTER TABLE me.voucher_expiry_warning ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON me.voucher_expiry_warning
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));
