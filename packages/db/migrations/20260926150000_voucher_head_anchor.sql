-- 4.6.h (D6, F11): the voucher service anchors each voucher's chain head
-- here as it advances, and the ledger's daily proof folds the day's anchors
-- into that day's root. created_at is stamped by the database, never the caller.
CREATE TABLE ledger.voucher_head_anchor (
  id         bigserial   PRIMARY KEY,
  voucher_id uuid        NOT NULL,
  seq        bigint      NOT NULL CHECK (seq > 0),
  head_hash  char(64)    NOT NULL CHECK (head_hash ~ '^[0-9a-f]{64}$'),
  region     text        NOT NULL CHECK (region IN ('AU', 'ID')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (voucher_id, seq)
);

CREATE INDEX voucher_head_anchor_created_idx ON ledger.voucher_head_anchor (created_at);

CREATE TRIGGER voucher_head_anchor_stamp_now BEFORE INSERT ON ledger.voucher_head_anchor
  FOR EACH ROW EXECUTE FUNCTION ledger.stamp_now();

GRANT SELECT, INSERT ON ledger.voucher_head_anchor TO yourtal_ledger;
GRANT USAGE ON SEQUENCE ledger.voucher_head_anchor_id_seq TO yourtal_ledger;
REVOKE UPDATE, DELETE ON ledger.voucher_head_anchor FROM yourtal_ledger;
REVOKE ALL ON ledger.voucher_head_anchor FROM yourtal_app;

-- ledger_root is what the proof always computed (entries only). merkle_root
-- becomes pairHash(ledger_root, voucher_heads_root) on a day with anchors and
-- stays ledger_root otherwise, so every day already recorded verifies unchanged.
ALTER TABLE ledger.daily_proof
  ADD COLUMN ledger_root text,
  ADD COLUMN voucher_heads_root text,
  ADD COLUMN voucher_head_count bigint NOT NULL DEFAULT 0;

-- The poster's watermark: the last chain seq it anchored for each voucher.
ALTER TABLE voucher.vouchers
  ADD COLUMN head_anchored_version integer NOT NULL DEFAULT 0;

CREATE INDEX vouchers_head_unanchored_idx ON voucher.vouchers (id)
  WHERE version > head_anchored_version;
