-- 14.3.a (group 2.1): a lasting link between a YourTal account and a partner
-- app (SnapApp first). The one-time code in me.link_code is exchanged for a
-- row here on the partner's first call; later calls name the link by its id,
-- so the 10-minute code is no longer needed on every receipt.
--
-- Revoking sets revoked_at and keeps the row, so a partner calling with a
-- revoked link gets `link_revoked` rather than an unknown id. One ACTIVE link
-- per (partner, user); a user who unlinks and links again gets a new row.
CREATE TABLE platform.partner_link (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id  text        NOT NULL REFERENCES platform.partner_credential (partner_id),
  user_id     text        NOT NULL,
  region      text        NOT NULL CHECK (region IN ('AU', 'ID')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);
CREATE UNIQUE INDEX partner_link_one_active_idx
  ON platform.partner_link (partner_id, user_id) WHERE revoked_at IS NULL;
CREATE INDEX partner_link_user_idx ON platform.partner_link (user_id);

-- The app links and revokes; it never rewrites who or where a link names.
GRANT SELECT, INSERT ON platform.partner_link TO yourtal_app;
GRANT UPDATE (revoked_at) ON platform.partner_link TO yourtal_app;

-- The region wall every region table carries (13.5.e, F92).
ALTER TABLE platform.partner_link ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON platform.partner_link
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));
