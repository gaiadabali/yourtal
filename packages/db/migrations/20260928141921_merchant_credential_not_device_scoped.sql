-- TASKS.md 8.3.f: `voucher.merchant_credential.device_id` was already
-- nullable, but `issueCredential` (apps/api's Studio -> Developers use
-- case) always filled it with the credential's own label -- meaning every
-- credential Studio has ever issued was device-scoped, and
-- services/voucher's void/refund routes refuse any device-scoped
-- credential (routes_release.go's refuseDevicePrincipal). Now that
-- issuance defaults to merchant-wide (no code change needed on the real
-- table's schema), null out every row this app has ever produced through
-- that flawed default -- there is no legitimate caller today that wants
-- device-scoping (confirmed by reading every caller: 8.3.f's own report),
-- so a non-null value here can only be a symptom of the bug this fixes.
UPDATE voucher.merchant_credential SET device_id = NULL WHERE device_id IS NOT NULL;

-- The fake-mode counterpart (platform.voucher_fake_credential, read by
-- apps/api's own FakeVoucherClient when LEDGER_MODE=fake) required
-- device_id NOT NULL, which the real table never did -- relax it to match,
-- then apply the same fix.
ALTER TABLE platform.voucher_fake_credential ALTER COLUMN device_id DROP NOT NULL;
UPDATE platform.voucher_fake_credential SET device_id = NULL WHERE device_id IS NOT NULL;
