-- YT-0044: the daily Merkle root.
--
-- docs/14 §8: "Daily Merkle root written to a write-once bucket in a
-- separate project and published. A verification job walks the chain
-- nightly." docs/14 §3 names what it defends against — a direct UPDATE on
-- the ledger via a leaked credential — and why it works: the service role
-- has no UPDATE or DELETE grant, so an edit needs a superuser, and a
-- published root makes that edit **detectable the next day**.
--
-- The root cannot PREVENT an edit. Nothing at the database layer can stop
-- someone who already holds superuser. What it does is make the edit
-- provable after the fact, which is the difference between a silent
-- restatement and an incident with a date on it.
--
-- Immutable by grant, like the rest of the value zone: INSERT and SELECT
-- only. A proof that can be rewritten proves nothing — an attacker who can
-- edit an entry and then recompute the root has defeated the whole scheme.

CREATE TABLE ledger.daily_proof (
  -- The UTC day this covers. One row per day, so recomputation cannot
  -- quietly append a second, more convenient answer.
  proof_date   date        PRIMARY KEY,
  merkle_root  char(64)    NOT NULL,
  -- Both recorded so a verifier can tell "the root differs" from "the root
  -- differs because rows appeared" — a late-arriving entry and a tampered
  -- one produce the same mismatch otherwise, and they are very different
  -- incidents.
  entry_count  bigint      NOT NULL CHECK (entry_count >= 0),
  first_entry_id bigint,
  last_entry_id  bigint,
  computed_at  timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON ledger.daily_proof TO yourtal_ledger;
REVOKE UPDATE, DELETE ON ledger.daily_proof FROM yourtal_ledger;
