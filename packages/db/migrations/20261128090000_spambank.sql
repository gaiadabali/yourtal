-- Spambank Stage 1, ticket T1 (god root 10.2; BUILD.md section 6): the `spambank`
-- schema. One mailbox per YourTal account, ingest bookkeeping, leads, the D2
-- auto-reply guards and the mail-event outbox. Add-only: a new schema, nothing
-- existing is touched.
--
-- Roles: only `yourtal_app` (the API and the worker connect as it) is granted
-- anything. The ledger, voucher and analyst roles get nothing, and no grant on
-- another schema changes. Grants are per table and as narrow as T4-T7 need:
-- the guard and retirement tables are never deleted from, `control` is a
-- singleton that can be updated but not inserted or deleted.
--
-- Region wall: the three tables that carry a `region` column (mailbox, lead,
-- lead_sighting) get the same `region_wall` policy as every other region table
-- (13.5.e, F92); apps/api's region-scope.e2e.test.ts fails a table that has a
-- region column and no such policy. The auto-reply guards are global on purpose
-- (they protect one sending reputation) and carry no region.
CREATE SCHEMA IF NOT EXISTS spambank;
REVOKE ALL ON SCHEMA spambank FROM PUBLIC;

-- One mailbox per YourTal account (D1). Never renamed; a deleted name is retired forever.
CREATE TABLE spambank.mailbox (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               text        NOT NULL UNIQUE,
  region                text        NOT NULL CHECK (region IN ('AU', 'ID')),
  local_part            text        NOT NULL UNIQUE CHECK (local_part ~ '^[a-z]{6,16}([1-9][0-9])?$'),
  domain                text        NOT NULL,
  stalwart_account_id   text        UNIQUE,
  junk_mailbox_id       text,
  status                text        NOT NULL CHECK (status IN ('provisioning', 'active', 'suspended', 'erasing')),
  enabled_via           text        NOT NULL CHECK (enabled_via IN ('yourtal', 'snapapp', 'ftr')),
  statements_to_snapapp boolean     NOT NULL DEFAULT false,
  new_mail_alerts       boolean     NOT NULL DEFAULT true,
  email_state           text,
  last_ingested_at      timestamptz,
  last_alert_at         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
-- The erase sweep and the provisioning retry read the rows that are not active.
CREATE INDEX mailbox_not_active_idx ON spambank.mailbox (status) WHERE status <> 'active';

-- A name that was ever given out. Insert-only for the app: a deleted name is never reused.
CREATE TABLE spambank.retired_name (
  local_part text        PRIMARY KEY,
  retired_at timestamptz NOT NULL DEFAULT now()
);

-- Backstop for the generator's own check (BUILD.md 4.1): a mailbox can never be
-- created under a retired name, whatever code inserts it. Raised as a unique
-- violation so the generator's retry-on-violation path handles it. Insert only:
-- the erase handler retires a name while its mailbox row still exists, and a
-- name is never changed, so an UPDATE trigger would only break that handler.
CREATE FUNCTION spambank.refuse_retired_name() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, spambank
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM spambank.retired_name r WHERE r.local_part = NEW.local_part) THEN
    RAISE EXCEPTION 'spambank: the name % is retired and is never given out again', NEW.local_part
      USING ERRCODE = 'unique_violation', CONSTRAINT = 'mailbox_local_part_retired';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER mailbox_local_part_not_retired
  BEFORE INSERT ON spambank.mailbox
  FOR EACH ROW EXECUTE FUNCTION spambank.refuse_retired_name();

-- Ingest idempotency and decisions; purged after 30 days.
CREATE TABLE spambank.ingested_message (
  mailbox_id         uuid        NOT NULL REFERENCES spambank.mailbox (id) ON DELETE CASCADE,
  email_id           text        NOT NULL,
  received_at        timestamptz NOT NULL,
  folder             text        NOT NULL CHECK (folder IN ('inbox', 'spam', 'junk', 'other')),
  bulk               boolean     NOT NULL,
  dmarc_pass         boolean     NOT NULL,
  from_org_domain    text,
  autoreply_decision text        NOT NULL,
  processed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mailbox_id, email_id)
);
CREATE INDEX ingested_message_processed_idx ON spambank.ingested_message (processed_at);
CREATE INDEX ingested_message_received_idx ON spambank.ingested_message (mailbox_id, received_at DESC);

-- Leads for GOD, one list per region.
CREATE TABLE spambank.lead (
  region               text        NOT NULL CHECK (region IN ('AU', 'ID')),
  org_domain           text        NOT NULL,
  display_name         text,
  sample_from          text,
  sample_subject       text,
  has_list_unsubscribe boolean     NOT NULL DEFAULT false,
  first_seen_at        timestamptz NOT NULL,
  last_seen_at         timestamptz NOT NULL,
  messages             integer     NOT NULL DEFAULT 0,
  status               text        NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'ignored', 'customer')),
  note                 text,
  PRIMARY KEY (region, org_domain)
);
CREATE INDEX lead_region_last_seen_idx ON spambank.lead (region, last_seen_at DESC);

CREATE TABLE spambank.lead_sighting (
  region        text        NOT NULL CHECK (region IN ('AU', 'ID')),
  org_domain    text        NOT NULL,
  mailbox_id    uuid        NOT NULL REFERENCES spambank.mailbox (id) ON DELETE CASCADE,
  first_seen_at timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL,
  messages      integer     NOT NULL DEFAULT 1,
  PRIMARY KEY (region, org_domain, mailbox_id),
  FOREIGN KEY (region, org_domain) REFERENCES spambank.lead (region, org_domain) ON DELETE CASCADE
);
CREATE INDEX lead_sighting_mailbox_idx ON spambank.lead_sighting (mailbox_id);

-- Auto-reply guards (D2 3, 5, 6). Global, not regional: they protect our sending reputation.
CREATE TABLE spambank.autoreply_domain (
  org_domain      text        PRIMARY KEY,
  last_replied_at timestamptz,
  opted_out_at    timestamptz,
  replies_total   integer     NOT NULL DEFAULT 0
);

CREATE TABLE spambank.autoreply (
  id                uuid        PRIMARY KEY,
  org_domain        text        NOT NULL,
  to_address        text        NOT NULL,
  source_mailbox_id uuid        REFERENCES spambank.mailbox (id) ON DELETE SET NULL,
  source_email_id   text,
  message_id        text        NOT NULL UNIQUE,
  mode              text        NOT NULL CHECK (mode IN ('redirect', 'live')),
  status            text        NOT NULL CHECK (status IN ('queued', 'sent', 'send_failed', 'bounced', 'complained')),
  error             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  sent_at           timestamptz
);
CREATE INDEX autoreply_domain_created_idx ON spambank.autoreply (org_domain, created_at DESC);
CREATE INDEX autoreply_created_idx ON spambank.autoreply (created_at);
CREATE INDEX autoreply_source_mailbox_idx ON spambank.autoreply (source_mailbox_id) WHERE source_mailbox_id IS NOT NULL;

CREATE TABLE spambank.autoreply_day (
  day        date    PRIMARY KEY,
  sent       integer NOT NULL DEFAULT 0 CHECK (sent >= 0),
  bounces    integer NOT NULL DEFAULT 0 CHECK (bounces >= 0),
  complaints integer NOT NULL DEFAULT 0 CHECK (complaints >= 0)
);

-- One row, ever: the kill-switch state and the daily cap (the `id` check and
-- primary key make a second row impossible).
CREATE TABLE spambank.control (
  id            boolean     PRIMARY KEY DEFAULT true CHECK (id),
  daily_cap     integer     NOT NULL DEFAULT 200 CHECK (daily_cap >= 0),
  paused_at     timestamptz,
  paused_reason text,
  updated_by    text,
  updated_at    timestamptz
);
INSERT INTO spambank.control DEFAULT VALUES;

-- Backstop for D2's global daily cap (BUILD.md 4.6 check 10): no insert or
-- increment can take `sent` past `control.daily_cap`, whatever query runs it.
-- (The claim query's own WHERE is the normal path; an upsert whose first insert
-- skips that WHERE, e.g. with the cap at 0, would otherwise slip one reply
-- through.) A lowered cap never blocks a decrease or an unrelated update.
CREATE FUNCTION spambank.refuse_over_daily_cap() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, spambank
AS $$
DECLARE
  cap integer;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.sent <= OLD.sent THEN
    RETURN NEW;
  END IF;
  SELECT c.daily_cap INTO cap FROM spambank.control c;
  IF NEW.sent > cap THEN
    RAISE EXCEPTION 'spambank: the daily auto-reply cap of % is reached', cap
      USING ERRCODE = 'check_violation', CONSTRAINT = 'autoreply_day_within_cap';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER autoreply_day_within_cap
  BEFORE INSERT OR UPDATE OF sent ON spambank.autoreply_day
  FOR EACH ROW EXECUTE FUNCTION spambank.refuse_over_daily_cap();

CREATE TABLE spambank.blocklist_check (
  id         bigserial   PRIMARY KEY,
  checked_at timestamptz NOT NULL DEFAULT now(),
  target     text        NOT NULL,
  list       text        NOT NULL,
  result     text        NOT NULL CHECK (result IN ('clean', 'listed', 'refused', 'error')),
  detail     text
);
CREATE INDEX blocklist_check_checked_idx ON spambank.blocklist_check (checked_at DESC);

-- The person's own sending and unsubscribes.
CREATE TABLE spambank.send_count (
  mailbox_id uuid    NOT NULL REFERENCES spambank.mailbox (id) ON DELETE CASCADE,
  day        date    NOT NULL,
  recipients integer NOT NULL DEFAULT 0 CHECK (recipients >= 0),
  PRIMARY KEY (mailbox_id, day)
);

CREATE TABLE spambank.unsubscribe (
  id          uuid        PRIMARY KEY,
  mailbox_id  uuid        NOT NULL REFERENCES spambank.mailbox (id) ON DELETE CASCADE,
  org_domain  text        NOT NULL,
  method      text        NOT NULL CHECK (method IN ('one_click', 'mailto', 'link')),
  status      text        NOT NULL CHECK (status IN ('done', 'failed', 'opened')),
  http_status integer,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX unsubscribe_mailbox_idx ON spambank.unsubscribe (mailbox_id, created_at DESC);

-- Statements offered to SnapApp.
CREATE TABLE spambank.statement_offer (
  mailbox_id uuid        NOT NULL REFERENCES spambank.mailbox (id) ON DELETE CASCADE,
  email_id   text        NOT NULL,
  blob_id    text        NOT NULL,
  name       text,
  type       text        NOT NULL,
  size       integer     NOT NULL,
  offered_at timestamptz NOT NULL DEFAULT now(),
  outcome    text        CHECK (outcome IN ('imported', 'duplicate', 'failed', 'skipped')),
  outcome_at timestamptz,
  detail     text,
  PRIMARY KEY (mailbox_id, email_id, blob_id)
);

-- Mail events for SnapApp (B8): same columns as oidc.event_outbox, plus an expiry.
-- It holds the app's `sub` and nothing else personal, like the table it mirrors.
CREATE TABLE spambank.app_event_outbox (
  jti             uuid        PRIMARY KEY,
  client_id       text        NOT NULL,
  sub             text        NOT NULL,
  event_type      text        NOT NULL,
  payload         jsonb       NOT NULL,
  iat             timestamptz NOT NULL,
  expires_at      timestamptz NOT NULL,
  attempts        int         NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz,
  failed_at       timestamptz,
  last_error      text
);
CREATE INDEX app_event_outbox_due_idx ON spambank.app_event_outbox (next_attempt_at)
  WHERE delivered_at IS NULL AND failed_at IS NULL;

-- The region wall every region table carries (13.5.e, F92).
ALTER TABLE spambank.mailbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON spambank.mailbox
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE spambank.lead ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON spambank.lead
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

ALTER TABLE spambank.lead_sighting ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_wall ON spambank.lead_sighting
  USING (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true))
  WITH CHECK (nullif(current_setting('yourtal.region', true), '') IS NULL OR region IS NULL OR region = current_setting('yourtal.region', true));

-- Grants: yourtal_app only. What each ticket needs:
--   T4 provisions, suspends and erases a mailbox (DELETE for the erase sweep) and retires its name;
--   T6 ingests (ingested_message, lead, sighting, offer, app_event_outbox) and purges;
--   T7 decides and claims (autoreply*, control, blocklist_check) and records unsubscribes.
GRANT USAGE ON SCHEMA spambank TO yourtal_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON spambank.mailbox TO yourtal_app;
-- Insert-only: a retired name is never reused, so it is never updated or deleted.
GRANT SELECT, INSERT ON spambank.retired_name TO yourtal_app;
-- The erase handler deletes these four rows for one person (BUILD.md 4.11); purge trims ingested_message.
GRANT SELECT, INSERT, UPDATE, DELETE ON spambank.ingested_message TO yourtal_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON spambank.lead_sighting TO yourtal_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON spambank.statement_offer TO yourtal_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON spambank.unsubscribe TO yourtal_app;
-- A lead is a brand, not a person: upserted and edited by staff, never deleted (it also
-- survives every mailbox that saw it).
GRANT SELECT, INSERT, UPDATE ON spambank.lead TO yourtal_app;
-- The guards are upserted and incremented, never deleted: a lost row would lift a throttle or an opt-out.
GRANT SELECT, INSERT, UPDATE ON spambank.autoreply_domain TO yourtal_app;
GRANT SELECT, INSERT, UPDATE ON spambank.autoreply TO yourtal_app;
GRANT SELECT, INSERT, UPDATE ON spambank.autoreply_day TO yourtal_app;
GRANT SELECT, UPDATE ON spambank.control TO yourtal_app;
GRANT SELECT, INSERT ON spambank.blocklist_check TO yourtal_app;
GRANT USAGE, SELECT ON SEQUENCE spambank.blocklist_check_id_seq TO yourtal_app;
GRANT SELECT, INSERT, UPDATE ON spambank.send_count TO yourtal_app;
-- The delivery job updates attempts and purges delivered rows, like oidc.event_outbox.
GRANT SELECT, INSERT, UPDATE, DELETE ON spambank.app_event_outbox TO yourtal_app;
