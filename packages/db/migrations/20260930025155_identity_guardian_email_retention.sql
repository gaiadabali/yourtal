-- TASKS.md 12.4.b (#4): guardian email retention.
--
-- 1. `identity.user_profile.guardian_email` is dropped. It was always a
--    COPY of what `identity.guardian_consent.guardian_email` already holds
--    (written once, at registration, by the same transaction — see
--    20260929080000's own header and `AuthService.register`) and had no
--    reader anywhere: the guardian-facing page never returns it
--    (`GuardianConsentView` carries no email field), and no other surface
--    reads this column. Two copies of the same address is two places a
--    retention rule can be applied to only one of, which is exactly how a
--    "we deleted it" turns out to be false. One copy, on the table that
--    actually needs it, dropped here.
--
-- 2. `identity.guardian_consent.guardian_email` becomes nullable — apps/
--    worker's new daily job (`guardian-email-purge.ts`) clears it once the
--    account has turned 18: at that point the account is an adult under
--    its own consent, and the address that consent flow needed is no
--    longer needed for anything. Still NOT NULL at the moment a row is
--    created (`GuardianConsentRepository.create`'s own contract is
--    unchanged) — only ever nulled out afterwards, by that one job.
--
-- 3. `identity.guardian_consent` gains DELETE — 20260929080000's own header
--    named this as "a later ticket's to extend, not this one's to
--    pre-empt with a grant nothing here yet uses". This is that ticket:
--    the DSAR/account-deletion handler (`eraseIdentity`,
--    `packages/db/src/dsar-handlers.ts`) now erases this row alongside
--    `user_profile`/`credential`/`session`, and the guardian delete-account
--    endpoint (12.4.b #6) runs the exact same handler.

ALTER TABLE identity.user_profile
  DROP COLUMN guardian_email;

ALTER TABLE identity.guardian_consent
  ALTER COLUMN guardian_email DROP NOT NULL;

GRANT DELETE ON identity.guardian_consent TO yourtal_app;
