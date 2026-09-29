-- TASKS.md 4.8.c: the wallet read now carries the voucher's real state
-- (active/held/redeemed/expired/voided) and remaining value, not just the
-- reserved/activated/released collapse. `platform.voucher_fake_voucher`
-- (FakeVoucherClient's own storage, 1.2.d) never modelled either --
-- `fake-voucher-redemption.ts`'s own comment says as much: "the fake has no
-- per-voucher remaining_value_minor ... it never modelled partial
-- redemption at all" -- a capture only ever wrote an audit row in
-- `voucher_fake_capture`, never touched the voucher itself.
--
-- `state` (reserved/activated/released) stays exactly as it is: it is the
-- CHECKOUT SAGA's own tracking column (allocated/minted/owned), a different
-- axis entirely from the voucher's real lifecycle, and nothing here needs
-- it to grow a fourth value. The real lifecycle state is DERIVED, not
-- stored, by `fake-voucher-wallet.ts` -- void_reason set means voided;
-- remaining_value_minor = 0 means redeemed; an unexpired, uncaptured row in
-- `voucher_fake_authorization` means held; otherwise active -- the same
-- shape `services/voucher`'s own real engine computes, just read from three
-- tables here instead of one `state` column, since the fake was never built
-- with one.
ALTER TABLE platform.voucher_fake_voucher
  ADD COLUMN remaining_value_minor bigint,
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN void_reason text CHECK (void_reason IN ('transfer', 'fraud', 'refund_reversal', 'admin'));

-- Backfill: every existing fake voucher's remaining value is its listing's
-- own face value (nothing has ever decremented it before this migration),
-- and a 90-day expiry from issuance for anything that predates this column
-- -- the same default TASKS.md 8.2.e's own local fixture helper already
-- uses for real listings.
UPDATE platform.voucher_fake_voucher v
   SET remaining_value_minor = l.face_value_minor,
       expires_at = v.created_at + interval '90 days'
  FROM store.listings l
 WHERE v.listing_id = l.id AND v.remaining_value_minor IS NULL;

ALTER TABLE platform.voucher_fake_voucher ALTER COLUMN remaining_value_minor SET NOT NULL;
ALTER TABLE platform.voucher_fake_voucher ALTER COLUMN expires_at SET NOT NULL;
