-- 1.6.a/1.6.c: everything external is a simulated driver (red line 11), and a
-- simulated message has to be something a reviewer can actually go look at —
-- not just "not sent". One shared outbox table, in `platform` for the same
-- reason `platform.idempotency` is (20260919000001): more than one boundary
-- (email, push, webhook) writes to it, and more than one process reads it
-- (apps/api's own /dev/inbox, and later apps/worker), so it cannot live
-- inside any one domain schema.
--
-- Each boundary's simulated driver in packages/drivers writes here instead
-- of actually calling a vendor. Nothing reads this table yet: 1.6.b's
-- /api/dev/inbox is a later task, and this migration only has to make the
-- table exist and be safe to write to concurrently from api and worker.
CREATE TABLE platform.sim_outbox (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which driver boundary produced this row. Not an enum type: every other
  -- CHECK-constrained "kind" column in this schema is a plain text CHECK
  -- (see chart_of_accounts's account_country_known), so a fourth boundary
  -- later is a migration that widens this constraint, not one that alters a
  -- shared type every other table using it would also need to know about.
  boundary         text        NOT NULL CHECK (boundary IN ('email', 'push', 'webhook')),

  -- F2's hard wall: every row belongs to exactly one region. A simulated
  -- message is always about some region-scoped account, business or
  -- campaign, so this is NOT NULL rather than defaulted — a boundary that
  -- cannot name a region has not been given enough context to send anything,
  -- real or simulated.
  region           text        NOT NULL CHECK (region IN ('AU', 'ID')),

  -- The email address, push device token, or webhook URL this would have
  -- gone to. Never a secret (unlike a real vendor's response), so this can
  -- sit here in plain text for a reviewer to read directly.
  recipient        text        NOT NULL,

  -- What kind of message this is within its boundary (e.g. "email_verify",
  -- "password_reset", "voucher_issued") — the driver's own vocabulary, not
  -- constrained here, because each boundary owns its own category names and
  -- this table is not the place to enumerate every one of them.
  category         text        NOT NULL,

  subject          text,
  body             text        NOT NULL,

  -- Structured extras a reviewer's UI can render specially (e.g. a
  -- verification link) without parsing `body`.
  metadata         jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_at       timestamptz NOT NULL DEFAULT now(),

  -- Same idempotency key a real vendor call would carry, scoped per
  -- boundary. A retried send must not create a second row a reviewer would
  -- read as two separate messages.
  idempotency_key  text        NOT NULL,

  CONSTRAINT sim_outbox_idempotency_unique UNIQUE (boundary, idempotency_key)
);

-- /dev/inbox-style reads want "everything of this boundary, newest first".
CREATE INDEX sim_outbox_boundary_created_at_idx ON platform.sim_outbox (boundary, created_at DESC);

-- UPDATE, not just SELECT/INSERT: the store's idempotent "replay returns the
-- original row" upsert is `INSERT ... ON CONFLICT DO UPDATE SET boundary =
-- EXCLUDED.boundary` (a no-op self-assignment, purely so RETURNING fires on
-- the replay path too) — same shape as platform.idempotency's putIfAbsent,
-- and Postgres requires UPDATE privilege for a DO UPDATE clause regardless
-- of what the SET assigns. DELETE for the same reason platform.idempotency
-- grants it: a future retention job prunes old rows the same way.
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.sim_outbox TO yourtal_app;
