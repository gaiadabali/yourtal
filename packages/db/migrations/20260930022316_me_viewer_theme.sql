-- TASKS.md 13.16.a: the viewer's colour theme. Its own table, not a column on
-- me.viewer_setting, whose autoplay is NOT NULL. No row = "system".
CREATE TABLE me.viewer_theme (
  user_id    text        PRIMARY KEY,
  theme      text        NOT NULL CHECK (theme IN ('system', 'light', 'dark')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON me.viewer_theme TO yourtal_app;
