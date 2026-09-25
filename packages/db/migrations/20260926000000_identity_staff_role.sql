-- 1.5.b: staff roles as rows, not a header a request could assert.
--
-- `packages/authz/src/roles.ts`'s INTERNAL_ROLES is the authoritative list;
-- the CHECK below is a copy of the same six strings so a typo in either
-- place is a migration failure or a policy-drift test failure, never a
-- silent grant of a role that does not exist. A user may hold more than one
-- internal role (docs/17 section 5 names people who wear two hats), so this
-- is one row per (user, role), not a single nullable column.
CREATE TABLE identity.staff_role (
  user_id     text        NOT NULL,
  role        text        NOT NULL
    CHECK (role IN ('support', 'moderator', 'risk_analyst', 'finance', 'ops', 'admin')),
  granted_by  text        NOT NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, role)
);

-- Read by AsyncPrincipalResolver on every request that reaches PdpGuard
-- (yourtal_app); written only by `pnpm staff:add` against the owner
-- connection (docs/14 section 8 -- a role grant is not a thing the running
-- application ever does to itself).
GRANT SELECT ON identity.staff_role TO yourtal_app;
