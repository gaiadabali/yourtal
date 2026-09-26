-- EW-08: a checkpoint has at most one LIVE token in flight at a time.
--
-- `watch.checkpoint_nonce` (20260921120000) records a SPENT nonce and
-- correctly stops the same token being answered twice. It says nothing
-- about ISSUANCE: nothing stopped a client minting a fresh token for
-- checkpoint 3 whenever it liked, including well ahead of when coverage
-- reached it, and `@Idempotent`'s replay only worked if the client reused
-- the same key — which nothing forced.
--
-- This table is the other half. `(session_id, checkpoint_index)` is the
-- primary key, so "is a token already live for this checkpoint" is a single
-- indexed lookup, and re-issuing a token for the SAME still-live nonce
-- returns the identical bytes (`issueCheckpointToken` is a pure function of
-- its claims) rather than minting a second one — so a client that lost the
-- response to a network blip can safely ask again without the endpoint
-- needing its own idempotency key.
CREATE TABLE watch.checkpoint_issue (
  session_id       uuid    NOT NULL REFERENCES watch.session (id),
  checkpoint_index integer NOT NULL CHECK (checkpoint_index >= 0),
  nonce            text    NOT NULL,
  expires_at       timestamptz NOT NULL,

  PRIMARY KEY (session_id, checkpoint_index)
);

-- INSERT and UPDATE (to replace an EXPIRED issuance with a fresh nonce), no
-- DELETE and no SELECT-anything-else: the app reads its own row by primary
-- key only, which `SELECT` covers.
GRANT SELECT, INSERT, UPDATE ON watch.checkpoint_issue TO yourtal_app;
