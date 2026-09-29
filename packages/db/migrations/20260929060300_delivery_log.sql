-- TASKS.md 10.4.c (EW-18): the delivery-log cross-check apps/api's
-- `apps/api/src/modules/watch/delivery-coverage.ts` already names as the
-- contract it is waiting on. A worker job loads the (real, in staging;
-- fixture, in dev) nginx access log and writes one row per signed HLS
-- request it recognises; `deliveryCoverage(sessionId)` reads this table.
--
-- Lives in `platform`, not `watch`: the writer is apps/worker (yourtal_app),
-- the reader is apps/api's own shared code, and this is evidence ABOUT a
-- watch session rather than part of the session itself -- the same
-- reasoning platform.sim_outbox gives for not living inside any one domain
-- schema.
CREATE TABLE platform.delivery_log (
  id             bigserial   PRIMARY KEY,
  session_id     uuid        NOT NULL,
  -- The HLS segment index parsed from the request path (segment%d.ts,
  -- packages/media's own naming, 7.2.b), null for a manifest request (a
  -- .m3u8 line still proves the session was reached, just not a span).
  segment_index  integer,
  path           text        NOT NULL,
  status_code    integer     NOT NULL,
  served_at      timestamptz NOT NULL,
  ingested_at    timestamptz NOT NULL DEFAULT now(),
  -- sha-256 of the raw log line: re-ingesting the same file (the job does
  -- not track a byte offset) must not create a second row for one request.
  line_hash      text        NOT NULL UNIQUE
);

CREATE INDEX delivery_log_session_idx ON platform.delivery_log (session_id, segment_index);

GRANT SELECT, INSERT ON platform.delivery_log TO yourtal_app;
REVOKE UPDATE, DELETE ON platform.delivery_log FROM yourtal_app;
GRANT USAGE, SELECT ON SEQUENCE platform.delivery_log_id_seq TO yourtal_app;
