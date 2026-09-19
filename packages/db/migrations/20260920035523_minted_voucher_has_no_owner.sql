-- YT-0141: a minted voucher belongs to nobody, and the column should say so.
--
-- Bulk issuance produces vouchers before anyone has redeemed points for one.
-- `owner_id uuid NOT NULL` forces the minting path to invent a placeholder,
-- and every placeholder is wrong in a way that matters later:
--
--   * the supplier's business id — now a merchant appears to hold vouchers
--     against itself, and every "vouchers per user" report counts them
--   * a fixed sentinel of its own — a third owner-shaped value nobody can
--     distinguish from the erasure tombstone without reading this file
--   * the NIL uuid — which IS the erasure tombstone, so unissued inventory
--     and the vouchers of people who exercised a deletion right become the
--     same rows
--
-- NULL is the honest answer, and it composes exactly with the distinction
-- `dsar-handlers.ts` already draws: a NULL owner reads as *"we never knew"*,
-- and the nil-uuid tombstone reads as *"we knew and were asked to forget"*.
-- For unissued inventory the first of those is simply true.
ALTER TABLE voucher.vouchers ALTER COLUMN owner_id DROP NOT NULL;

-- And the two facts are tied, so neither can drift from the other: a voucher
-- with no owner must be unissued, and an issued one must have an owner.
--
-- Written as an equality of two IS NULL tests rather than as
-- `CHECK (state <> 'minted' OR owner_id IS NULL)`, which is the shape that
-- PASSES on NULL — `FALSE OR NULL` is NULL and Postgres accepts a CHECK that
-- evaluates to NULL. e3 shipped one of those today and it refused two of
-- three wrong states. The `iff` form has no such hole in either direction.
ALTER TABLE voucher.vouchers
  ADD CONSTRAINT vouchers_owner_iff_issued CHECK (
    (state = 'minted') = (owner_id IS NULL)
  );
