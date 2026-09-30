-- 13.1: the demo logins the last `demo:reset` made, for the review guide (13.2).
-- No password lives here (it is STAGING_DEMO_PASSWORD); a teen's guardian page
-- is reached by link, so its link is kept. Staff rows exist but the guide
-- does not list them (13.2.a).
CREATE TABLE platform.demo_login (
  email         text        PRIMARY KEY,
  user_id       text        NOT NULL,
  region        text        NOT NULL CHECK (region IN ('AU', 'ID')),
  role          text        NOT NULL,
  is_staff      boolean     NOT NULL DEFAULT false,
  guardian_link text,
  reset_at      timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON platform.demo_login TO yourtal_app;

-- The region wall every region table carries (13.5.e).
ALTER TABLE platform.demo_login ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON platform.demo_login
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));
