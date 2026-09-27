-- TASKS.md 9.1.a: every staff console action writes one row here. Append-only
-- for everyone, owner included: a trigger refuses UPDATE and DELETE, so a
-- staff member with database access cannot quietly rewrite their own trail.
CREATE SCHEMA IF NOT EXISTS staff;

CREATE TABLE staff.audit_event (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  actor_user_id text        NOT NULL,
  actor_roles   text[]      NOT NULL CHECK (cardinality(actor_roles) > 0),
  -- A dotted verb from the route's @StaffAction, e.g. 'kyb.approve'.
  action        text        NOT NULL CHECK (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  outcome       text        NOT NULL CHECK (outcome IN ('succeeded', 'failed')),
  http_status   smallint    NOT NULL,
  target_kind   text,
  target_id     text,
  region        text        CHECK (region IN ('AU', 'ID')),
  reason        text,
  detail        jsonb       NOT NULL DEFAULT '{}',
  request_id    text,
  CHECK ((target_kind IS NULL) = (target_id IS NULL))
);

CREATE INDEX audit_event_actor_idx ON staff.audit_event (actor_user_id, occurred_at DESC);
CREATE INDEX audit_event_target_idx ON staff.audit_event (target_kind, target_id, occurred_at DESC);

CREATE FUNCTION staff.audit_event_is_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'staff.audit_event is append-only';
END;
$$;

CREATE TRIGGER audit_event_append_only
  BEFORE UPDATE OR DELETE ON staff.audit_event
  FOR EACH ROW EXECUTE FUNCTION staff.audit_event_is_append_only();

GRANT USAGE ON SCHEMA staff TO yourtal_app;
GRANT SELECT, INSERT ON staff.audit_event TO yourtal_app;
