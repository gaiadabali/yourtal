-- YT-0045: the Reward Engine's own state — funded allocations and the grant
-- log that velocity caps are counted from.
--
-- Both live in the `ledger` schema and are owned by the ledger role. The
-- Reward Engine is the only path from a verified action to a points credit
-- (docs/18 §9), and it posts to the ledger itself, so it is value-zone code:
-- putting its state anywhere the app role could reach would make the "only
-- path" claim false by grant.
--
-- SCOPE: everything here counts POINTS. docs/16 K6 requires every unfunded
-- point to be backed by real cash at issuance; the cash half is recorded
-- when a partner pre-purchases (YT-0046), not when a point is issued. What
-- this migration enforces is the half that is unit-agnostic and therefore
-- buildable now: you cannot issue a point without an allocation behind it.

CREATE TABLE ledger.allocation (
  id               text        PRIMARY KEY,
  -- `partner` is an advertiser's pre-purchased block; `marketing` is the
  -- platform funding its own grants — streaks, referrals, goodwill. Two
  -- kinds rather than one because they post to different contra accounts,
  -- and collapsing them would hide marketing spend inside funded issuance.
  funder_type      text        NOT NULL CHECK (funder_type IN ('partner', 'marketing')),
  funder_id        text        NOT NULL,
  currency         char(3)     NOT NULL CHECK (currency = 'YTP'),
  total_points     bigint      NOT NULL CHECK (total_points > 0),
  remaining_points bigint      NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  -- The K6 gate, as a constraint rather than a convention. Drawdown is
  -- `UPDATE ... WHERE remaining_points >= $n`, so an exhausted allocation
  -- simply matches no row — but if a bug ever tried to push it negative,
  -- this refuses. An allocation that can go negative is a licence to mint.
  CONSTRAINT allocation_not_overdrawn CHECK (remaining_points >= 0),
  CONSTRAINT allocation_not_overfunded CHECK (remaining_points <= total_points)
);

CREATE INDEX allocation_funder_idx ON ledger.allocation (funder_type, funder_id);

-- Every grant the engine has made. This is what velocity caps are counted
-- from, which is why it is a table and not a metric: a cap enforced against
-- something lossy is not a cap.
CREATE TABLE ledger.grant (
  id            text        PRIMARY KEY,
  user_id       text        NOT NULL,
  action_type   text        NOT NULL,
  -- The taxonomy version in force when this was granted. docs/18 §9 makes
  -- the taxonomy versioned; without recording which version priced a grant,
  -- a later change silently rewrites history in every report.
  taxonomy_ver  integer     NOT NULL,
  points        bigint      NOT NULL CHECK (points > 0),
  allocation_id text        NOT NULL REFERENCES ledger.allocation (id),
  transfer_id   text        NOT NULL REFERENCES ledger.transfer (id),
  device_id     text,
  ip_address    text,
  -- The caller's own reference, so the same external action cannot be
  -- granted twice even across retries with different idempotency keys.
  external_ref  text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT grant_external_ref_once UNIQUE (user_id, action_type, external_ref)
);

CREATE INDEX grant_user_day_idx   ON ledger.grant (user_id, created_at);
CREATE INDEX grant_device_day_idx ON ledger.grant (device_id, created_at);
CREATE INDEX grant_ip_day_idx     ON ledger.grant (ip_address, created_at);

GRANT SELECT, INSERT, UPDATE ON ledger.allocation TO yourtal_ledger;
GRANT SELECT, INSERT ON ledger.grant TO yourtal_ledger;

-- Append-only, like everything else in the value zone. An allocation's
-- remaining balance is the one field that legitimately changes, and it only
-- ever moves down through the drawdown statement.
REVOKE DELETE ON ledger.allocation, ledger.grant FROM yourtal_ledger;
REVOKE UPDATE ON ledger.grant FROM yourtal_ledger;
