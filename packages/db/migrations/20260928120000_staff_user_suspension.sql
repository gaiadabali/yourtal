-- TASKS.md 9.4.b: which ledger escrow a staff suspension moved a user's
-- available and pending points into, so `release` can find it again. The
-- ledger client (`escrow`/`releaseEscrow`) has no "find the active escrow
-- for this user" query, so the staff module -- which owns this screen --
-- tracks the mapping itself, the same "own narrow SQL, never edit the
-- identity module" convention `staff-directory.ts` and `staff.audit_event`
-- already follow.
CREATE TABLE staff.user_suspension (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      text        NOT NULL,
  -- NULL when there was nothing to escrow (a fresh, zero-balance account):
  -- `platform.ledger_fake_escrow.points` (and the real ledger) require
  -- points > 0, so suspending an empty account creates no escrow row at all.
  escrow_id    text,
  points       bigint      NOT NULL CHECK (points >= 0),
  reason       text        NOT NULL,
  suspended_by text        NOT NULL,
  suspended_at timestamptz NOT NULL DEFAULT now(),
  released_by  text,
  released_at  timestamptz,
  CHECK ((released_by IS NULL) = (released_at IS NULL))
);

-- At most one OPEN suspension per user at a time -- a second suspend attempt
-- while one is already open is a 409, not a second escrow.
CREATE UNIQUE INDEX user_suspension_one_open ON staff.user_suspension (user_id)
  WHERE released_at IS NULL;

CREATE INDEX user_suspension_user_idx ON staff.user_suspension (user_id, suspended_at DESC);

GRANT SELECT, INSERT, UPDATE ON staff.user_suspension TO yourtal_app;
REVOKE DELETE ON staff.user_suspension FROM yourtal_app;
