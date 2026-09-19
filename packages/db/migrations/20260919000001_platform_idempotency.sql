-- YT-0518 / YT-0039: the shared idempotency table.
--
-- One table, every service (docs/10 line 226), so a retry that lands on a
-- different service still finds the record. Lives in `platform` rather than
-- in any domain schema for that reason.
--
-- The primary key is (scope, key), never key alone. docs/14 section 6 scopes
-- it `(merchant, key)`: unscoped, two tenants picking the same key means the
-- second silently receives the first one's response, and an attacker who can
-- guess a key can pre-poison it so a legitimate request replays their stored
-- answer instead of executing.
CREATE TABLE platform.idempotency (
  scope        text        NOT NULL,
  key          text        NOT NULL,
  fingerprint  char(64)    NOT NULL,
  state        text        NOT NULL CHECK (state IN ('in_progress', 'completed')),
  status       smallint,
  body         text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,

  CONSTRAINT idempotency_pkey PRIMARY KEY (scope, key),

  CONSTRAINT idempotency_key_length CHECK (char_length(key) BETWEEN 1 AND 255),

  -- A completed row must carry what it replays; an in-progress row must not
  -- pretend to. Stated here as well as in Zod because the database is the
  -- only one of the two that a service in another language must pass through.
  CONSTRAINT idempotency_completed_has_response CHECK (
    (state = 'completed'   AND status IS NOT NULL AND body IS NOT NULL) OR
    (state = 'in_progress' AND status IS NULL     AND body IS NULL)
  )
);

-- Pruning reads this; nothing on the request path does.
CREATE INDEX idempotency_expires_at_idx ON platform.idempotency (expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.idempotency TO yourtal_app;
