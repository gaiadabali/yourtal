-- Spambank Stage 1, ticket T7 (god root 10.4; BUILD.md 4.6, 5.4): what the
-- counter-spam auto-reply needs beyond T1's tables. Add-only.
--
-- 1. The staff kill switch (BUILD.md 4.6 check 0, "platform setting
--    `spambank.autoreply` tripped"). It lives on the singleton `control` row
--    next to the auto-pause, because both are read in the same transaction
--    that claims a reply's slots: a trip takes effect on the very next claim.
--    `tripped_*` is set and cleared only by staff (`admin`, `ops`, Cerbos
--    `platform_setting.trip_kill_switch`); `paused_*` is set by the auto-pause
--    and cleared only by staff.
ALTER TABLE spambank.control
  ADD COLUMN tripped_at     timestamptz,
  ADD COLUMN tripped_reason text,
  ADD COLUMN tripped_by     text;

-- 2. Mail delivered to the system addresses (reply@, abuse@, postmaster@ on
--    the reply domain): bounces, complaints and people answering. One row per
--    message read, written in the same transaction as the counters it moves,
--    so a message read twice (the webhook's job and the minute's cron, or a
--    retry after a crash) counts once. Purged after 30 days.
CREATE TABLE spambank.reply_inbox_message (
  login        text        NOT NULL,
  email_id     text        NOT NULL,
  kind         text        NOT NULL CHECK (kind IN ('bounce', 'complaint', 'answer', 'ignored')),
  autoreply_id uuid,
  org_domain   text,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (login, email_id)
);
CREATE INDEX reply_inbox_message_processed_idx ON spambank.reply_inbox_message (processed_at);

GRANT SELECT, INSERT, DELETE ON spambank.reply_inbox_message TO yourtal_app;
