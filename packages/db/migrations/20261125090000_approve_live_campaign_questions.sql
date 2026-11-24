-- 2026-11-25: moderator approval never marked a campaign's questions approved, so
-- every Studio-authored campaign went live with an all-draft bank: the player's
-- checkpoint found nothing askable (askableBank reads only 'approved') and no
-- viewer could earn. The approve use case now approves the screened bank before
-- the live transition; this backfills the campaigns that already went through it.
--
-- Data only. Touches 'draft' rows the automated screen cleared, on campaigns a
-- moderator already approved (live or paused). Retired rows, unscreened or
-- refused rows, and every campaign still in draft or review are left alone, and
-- the existing CHECK (status <> 'approved' OR pii_screen = 'clear') still holds.
-- Seeded demo banks are already 'approved', so they are not matched. Rollback:
-- none needed; these questions are exactly what the moderator approved.
UPDATE campaign.question q
   SET status = 'approved'
  FROM campaign.campaigns c
 WHERE c.id = q.campaign_id
   AND c.lifecycle_state IN ('live', 'paused')
   AND q.status = 'draft'
   AND q.pii_screen = 'clear';
