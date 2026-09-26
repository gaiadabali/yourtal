-- 5.1.b/5.3.a: whether a session's completion actually produced a ledger
-- grant. `non_earning` (20260926130000) is decided at START, from the
-- allocation hold and the already-earned check; `granted` is decided at
-- COMPLETION, from whether `grantReward` actually succeeded. The two can
-- differ (an earning session whose grant call fails for some OTHER reason
-- at the last moment), so "has this user already earned this campaign" —
-- the gate a future `start()` checks — reads `granted`, not `non_earning`.
ALTER TABLE watch.session
  ADD COLUMN granted boolean NOT NULL DEFAULT false;

ALTER TABLE watch.session ADD CONSTRAINT session_granted_only_if_completed CHECK (
  NOT granted OR state = 'completed'
);
