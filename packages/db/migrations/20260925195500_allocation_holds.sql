-- 4.4.e, EM-08: allocations move only through four SECURITY DEFINER verbs,
-- hold, consume, release and return; the ledger role loses UPDATE on
-- ledger.allocation. A hold reserves a reward session's points at its start,
-- so a viewer is never refused at the end for an exhausted allocation.

CREATE TABLE ledger.allocation_hold (
  id              text        PRIMARY KEY,
  allocation_id   text        NOT NULL REFERENCES ledger.allocation (id),
  points          bigint      NOT NULL CHECK (points > 0),
  state           text        NOT NULL CHECK (state IN ('held', 'consumed', 'released')),
  consumed_points bigint      CHECK (consumed_points IS NULL OR (consumed_points > 0 AND consumed_points <= points)),
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz
);
CREATE INDEX allocation_hold_expiry_idx ON ledger.allocation_hold (expires_at) WHERE state = 'held';

-- A grant's points go back to its allocation at most once.
CREATE TABLE ledger.allocation_return (
  grant_id    text        PRIMARY KEY REFERENCES ledger.grant (id),
  points      bigint      NOT NULL CHECK (points > 0),
  returned_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON ledger.allocation_hold, ledger.allocation_return TO yourtal_ledger;
REVOKE INSERT, UPDATE, DELETE ON ledger.allocation_hold, ledger.allocation_return FROM yourtal_ledger;
REVOKE UPDATE ON ledger.allocation FROM yourtal_ledger;

-- hold: take p_points out of the allocation for p_ttl_seconds. False when the
-- allocation cannot cover it. Idempotent on p_hold_id.
CREATE FUNCTION ledger.allocation_hold(p_hold_id text, p_allocation_id text, p_points bigint, p_ttl_seconds bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ledger, pg_temp AS $$
DECLARE
  prior ledger.allocation_hold;
BEGIN
  IF p_points <= 0 OR p_ttl_seconds <= 0 THEN
    RAISE EXCEPTION 'ledger: a hold needs positive points and ttl' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO prior FROM ledger.allocation_hold WHERE id = p_hold_id;
  IF FOUND THEN
    IF prior.allocation_id <> p_allocation_id OR prior.points <> p_points THEN
      RAISE EXCEPTION 'ledger: hold % was placed for another allocation or amount', p_hold_id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN true;
  END IF;
  UPDATE ledger.allocation SET remaining_points = remaining_points - p_points
   WHERE id = p_allocation_id AND remaining_points >= p_points;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  INSERT INTO ledger.allocation_hold (id, allocation_id, points, state, expires_at)
  VALUES (p_hold_id, p_allocation_id, p_points, 'held', now() + make_interval(secs => p_ttl_seconds));
  RETURN true;
END;
$$;

-- consume: a grant uses p_points of a live hold; the rest goes back. Returns
-- the allocation id, or NULL when the hold is not live.
CREATE FUNCTION ledger.allocation_consume(p_hold_id text, p_points bigint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ledger, pg_temp AS $$
DECLARE
  live ledger.allocation_hold;
BEGIN
  SELECT * INTO live FROM ledger.allocation_hold
   WHERE id = p_hold_id AND state = 'held' AND expires_at > now() FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF p_points <= 0 OR p_points > live.points THEN
    RAISE EXCEPTION 'ledger: hold % covers % points, not %', p_hold_id, live.points, p_points
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE ledger.allocation_hold SET state = 'consumed', consumed_points = p_points, resolved_at = now()
   WHERE id = p_hold_id;
  IF live.points > p_points THEN
    UPDATE ledger.allocation SET remaining_points = remaining_points + (live.points - p_points)
     WHERE id = live.allocation_id;
  END IF;
  RETURN live.allocation_id;
END;
$$;

-- release: an abandoned or expired hold gives its points back.
CREATE FUNCTION ledger.allocation_release(p_hold_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ledger, pg_temp AS $$
DECLARE
  freed ledger.allocation_hold;
BEGIN
  UPDATE ledger.allocation_hold SET state = 'released', resolved_at = now()
   WHERE id = p_hold_id AND state = 'held' RETURNING * INTO freed;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  UPDATE ledger.allocation SET remaining_points = remaining_points + freed.points WHERE id = freed.allocation_id;
  RETURN true;
END;
$$;

CREATE FUNCTION ledger.allocation_release_expired()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = ledger, pg_temp AS $$
DECLARE
  stale text;
  freed integer := 0;
BEGIN
  FOR stale IN SELECT id FROM ledger.allocation_hold
                WHERE state = 'held' AND expires_at <= now() FOR UPDATE SKIP LOCKED LOOP
    IF ledger.allocation_release(stale) THEN
      freed := freed + 1;
    END IF;
  END LOOP;
  RETURN freed;
END;
$$;

-- return: a reversed grant's points go back to the allocation it drew, once.
CREATE FUNCTION ledger.allocation_return(p_grant_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ledger, pg_temp AS $$
DECLARE
  granted ledger.grant;
BEGIN
  SELECT * INTO granted FROM ledger.grant WHERE id = p_grant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ledger: no grant %', p_grant_id USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO ledger.allocation_return (grant_id, points) VALUES (granted.id, granted.points)
  ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  UPDATE ledger.allocation SET remaining_points = remaining_points + granted.points
   WHERE id = granted.allocation_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION ledger.allocation_hold(text, text, bigint, bigint), ledger.allocation_consume(text, bigint),
  ledger.allocation_release(text), ledger.allocation_release_expired(), ledger.allocation_return(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ledger.allocation_hold(text, text, bigint, bigint), ledger.allocation_consume(text, bigint),
  ledger.allocation_release(text), ledger.allocation_release_expired(), ledger.allocation_return(text) TO yourtal_ledger;
