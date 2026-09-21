-- YT-0121: what makes a checkpoint token single-use.
--
-- The signature proves a token is ours. It cannot prove the token has not
-- been used, because a valid signature stays valid — the same bytes verify
-- perfectly the second time they are presented. Only a record of the spend
-- makes a token single-use, and only a UNIQUE constraint makes that record
-- race-free.
--
-- The AC for this ticket says "nonce burned in Redis". It lives here
-- instead, deliberately. `docker-compose.yml` runs Valkey with
-- `--save "" --appendonly no` — persistence fully disabled — so a nonce
-- burned there is forgotten on any restart, and every unexpired spent token
-- becomes replayable at the moment the container comes back. Not one at a
-- time: all of them, at once. A container restart is an ordinary event.
--
-- The durable statement of the requirement is a property, not a store: a
-- spent nonce cannot be spent again, across a restart. Postgres satisfies
-- that; a cache configured to forget does not.

CREATE TABLE watch.checkpoint_nonce (
  -- The nonce IS the primary key, so the burn is an INSERT that either wins
  -- or conflicts. `packages/idempotency/src/store.ts` makes this argument at
  -- length and it applies unchanged: there is no `get` here either, because
  -- get-then-insert cannot be made safe. Two concurrent presentations of one
  -- token both read "unspent", both insert, and both are accepted — which is
  -- the exact replay this table exists to stop, reintroduced by the shape of
  -- the query.
  nonce            text        PRIMARY KEY,

  session_id       uuid        NOT NULL REFERENCES watch.session (id),
  checkpoint_index integer     NOT NULL CHECK (checkpoint_index >= 0),

  -- Server clock, never the client's.
  spent_at         timestamptz NOT NULL DEFAULT now(),

  -- The token's own expiry, copied from its signed claims. Pruning reads
  -- this; see the note below on why deleting past it loses nothing.
  expires_at       timestamptz NOT NULL,

  -- The constraint that matters more than the nonce.
  --
  -- Nonce uniqueness stops the SAME token being presented twice. It does
  -- nothing about a viewer who asks for two tokens for checkpoint 3 and
  -- spends both, because issuance mints a fresh nonce each time and both are
  -- legitimately signed. This says a checkpoint in a session can be answered
  -- once, whatever it was answered with — and it says it in the database, not
  -- in a service check, for the same reason `session_one_active_per_user` is
  -- a partial unique index: only the database settles a race between two
  -- concurrent requests that both read "not yet answered".
  CONSTRAINT checkpoint_answered_once_per_session UNIQUE (session_id, checkpoint_index)
);

-- Pruning reads this; the primary key serves the burn.
CREATE INDEX checkpoint_nonce_expires_at ON watch.checkpoint_nonce (expires_at);

-- DELETE is granted here and is NOT granted on `watch.coverage`, which is
-- worth stating rather than leaving as an inconsistency for a reader to
-- trip over.
--
-- Coverage is the evidence a reward is paid against, so evidence that can be
-- edited afterwards is not evidence. A spent nonce past its `expires_at` is
-- evidence of nothing: the signature layer refuses an expired token on its
-- own, before this table is ever consulted, so a row that outlives its
-- expiry protects against nothing and only grows. Deleting past expiry
-- cannot weaken the guarantee, because the guarantee has already moved to
-- the expiry check by then.
--
-- No UPDATE. A spend is a fact about a moment; there is nothing about it to
-- amend, and an UPDATE grant would let a bug rewrite which checkpoint a
-- nonce belonged to.
GRANT SELECT, INSERT, DELETE ON watch.checkpoint_nonce TO yourtal_app;
