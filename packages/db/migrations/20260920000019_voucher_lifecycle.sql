-- YT-0142: the voucher lifecycle replaces the stored public status, and the
-- plaintext code leaves the table.
--
-- Split out from 0015 deliberately. 0015 added only what nothing else read,
-- so the tree stayed green for the other streams; this one changes columns
-- that `packages/contracts` and the seed both depend on, and therefore lands
-- in the same commit as them. A schema change that arrives ahead of its
-- contract has cost two streams their verification this week — the header of
-- `schema-drift.test.ts` records both.
--
-- ## The status column is derived, not stored
--
-- `voucherSchema.status` carries `active | redeemed | expired | transferred`:
-- what a WALLET shows. YT-0142's lifecycle has seven states, including
-- `minted` (issued, belongs to nobody) and `held` (an authorization is
-- outstanding). The public enum has no way to say either, and should not.
--
-- Storing both would be two copies of one fact, and the copy is what goes
-- stale. `publicVoucherStatusOf` derives one from the other, exactly as
-- `publicStatusOf` does for campaigns since YT-0101.
--
-- ## The code column is deleted, not encrypted in place
--
-- See 0015's header for the full reasoning. In short: a plaintext code
-- readable by the app role means one leaked credential is the entire voucher
-- float, and encrypting the column in place would break the lookup, because
-- `WHERE code = $1` against ciphertext needs deterministic encryption —
-- which is a dictionary away from being no encryption. The code now lives as
-- a hash (for lookup) plus an envelope-encrypted copy (for display), in
-- `voucher.code_custody`, which the app role cannot see at all.

ALTER TABLE voucher.vouchers
  ADD COLUMN state text NOT NULL DEFAULT 'active' CHECK (
    state IN ('minted', 'allocated', 'active', 'held', 'redeemed', 'expired', 'voided'));

-- Why a voucher was voided. This is what distinguishes the two cases a
-- wallet must show differently: voided by TRANSFER means it became somebody
-- else's and its value still exists (docs/09 §7's void-and-remint); voided
-- for fraud means it did not.
ALTER TABLE voucher.vouchers ADD COLUMN void_reason text CHECK (
  void_reason IN ('transfer', 'fraud', 'refund_reversal', 'admin'));

ALTER TABLE voucher.vouchers ADD COLUMN batch_id uuid REFERENCES voucher.batch (id);

-- Optimistic concurrency (YT-0142). Every transition is
-- `UPDATE ... WHERE id = $1 AND version = $2`, so two concurrent writers
-- cannot both believe they moved the voucher: the loser matches no row and
-- is told to re-read rather than silently overwriting the winner.
ALTER TABLE voucher.vouchers ADD COLUMN version integer NOT NULL DEFAULT 1;

-- Existing rows are seeded mock vouchers, mapped back through the derivation
-- rather than defaulted — the same choice the campaign migration made, and
-- for the same reason: defaulting would have silently relabelled real data.
UPDATE voucher.vouchers
   SET state = CASE status
                 WHEN 'active'   THEN 'active'
                 WHEN 'redeemed' THEN 'redeemed'
                 WHEN 'expired'  THEN 'expired'
                 ELSE 'voided'
               END,
       void_reason = CASE WHEN status = 'transferred' THEN 'transfer' END;

ALTER TABLE voucher.vouchers DROP COLUMN status;
ALTER TABLE voucher.vouchers ALTER COLUMN state DROP DEFAULT;

-- `voided` is the one state that must explain itself, and only it may.
ALTER TABLE voucher.vouchers
  ADD CONSTRAINT vouchers_void_reason_iff_voided CHECK (
    (state = 'voided') = (void_reason IS NOT NULL)
  );

CREATE INDEX vouchers_state_idx ON voucher.vouchers (state);
CREATE INDEX vouchers_batch_idx ON voucher.vouchers (batch_id);

-- The plaintext code goes. Custody (0015) is now its only home.
ALTER TABLE voucher.vouchers DROP COLUMN code;

-- The app role keeps SELECT — a wallet has to render a voucher — and loses
-- every write. Minting and every state change belong to the voucher service,
-- and "belong to" is a permission rather than a convention (docs/13, module
-- boundaries enforced twice).
--
-- ⚠️ Risk 45: the running application currently connects as a superuser with
-- BYPASSRLS, so this is enforced in tests and bypassed by the live process
-- until YT-0554 lands.
REVOKE INSERT, UPDATE, DELETE ON voucher.vouchers FROM yourtal_app;
GRANT SELECT ON voucher.vouchers TO yourtal_app;
