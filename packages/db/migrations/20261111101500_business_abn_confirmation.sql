-- 6.10.b: what the ABR ("ABN Lookup") said about a business's ABN, written by a
-- staff action only when ABR_GUID is set. All four columns are NULL until a check
-- succeeds ("not checked"); a check never changes the ABN itself. `abn_confirmed_abn`
-- is the number that was checked, so a later edit cannot inherit a stale confirmation.
ALTER TABLE business.business_accounts
  ADD COLUMN abn_confirmed_at     timestamptz,
  ADD COLUMN abn_confirmed_abn    text,
  ADD COLUMN abn_entity_name      text,
  ADD COLUMN abn_gst_registered   boolean;

ALTER TABLE business.business_accounts
  ADD CONSTRAINT business_abn_confirmed_all_or_none CHECK (
    (abn_confirmed_at IS NULL AND abn_confirmed_abn IS NULL
       AND abn_entity_name IS NULL AND abn_gst_registered IS NULL)
    OR (abn_confirmed_at IS NOT NULL AND abn_confirmed_abn IS NOT NULL
       AND abn_entity_name IS NOT NULL AND abn_gst_registered IS NOT NULL)
  );
