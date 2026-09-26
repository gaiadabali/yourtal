-- TASKS.md 6.7.a: the viewer's own display settings, starting with autoplay.
-- One row per user, written only when they change the default — absence of
-- a row means "use the region default" (AutoplaySettingReader resolves
-- that, never this table alone), the same "no row = default" convention
-- `me.notification_preference` already uses.
CREATE TABLE me.viewer_setting (
  user_id    text        PRIMARY KEY,
  autoplay   text        NOT NULL CHECK (autoplay IN ('always', 'wifi_only', 'never')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON me.viewer_setting TO yourtal_app;
