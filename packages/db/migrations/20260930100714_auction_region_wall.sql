-- 13.22: the region wall (20260930082025's shape) on the auction and escrow tables.

ALTER TABLE voucher.escrow ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON voucher.escrow
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE platform.voucher_fake_escrow ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON platform.voucher_fake_escrow
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE auction.auction ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON auction.auction
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE auction.bid ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON auction.bid
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));
