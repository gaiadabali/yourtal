-- 4.7.c / K13 (requested by A): FakeVoucherClient's voidVoucher needs a
-- "voided" state its own table can hold. The real voucher.vouchers table
-- already has one (lifecycle.Voided); this is the platform.voucher_fake_*
-- mirror (20260925190500) catching up to a state the fake did not need
-- until this task added it.
ALTER TABLE platform.voucher_fake_voucher DROP CONSTRAINT voucher_fake_voucher_state_check;
ALTER TABLE platform.voucher_fake_voucher
  ADD CONSTRAINT voucher_fake_voucher_state_check
    CHECK (state IN ('reserved', 'activated', 'released', 'voided'));
