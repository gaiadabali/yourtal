-- 4.4.g: which holdback releases the worker has announced as
-- `ledger.points_unlocked`. Append-only: a row means "sent", so a crash
-- between send and acknowledgement re-sends, never loses (at-least-once).
CREATE TABLE ledger.release_notice (
  grant_id   text        PRIMARY KEY REFERENCES ledger.grant_release (grant_id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER release_notice_stamp_now BEFORE INSERT ON ledger.release_notice
  FOR EACH ROW EXECUTE FUNCTION ledger.stamp_now();

-- The worker pages through releases oldest first.
CREATE INDEX grant_release_created_idx ON ledger.grant_release (created_at, grant_id);

GRANT SELECT, INSERT ON ledger.release_notice TO yourtal_ledger;
REVOKE UPDATE, DELETE ON ledger.release_notice FROM yourtal_ledger;
REVOKE ALL ON ledger.release_notice FROM yourtal_app;
