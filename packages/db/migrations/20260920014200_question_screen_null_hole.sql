-- YT-0102 follow-up: close a three-valued-logic hole in the PII screen gate.
--
-- `20260920000017_question_bank.sql` wrote the gate as:
--
--     CHECK (status <> 'approved' OR pii_screen = 'clear')
--
-- which is wrong, and wrong in the direction that matters. When `pii_screen`
-- is NULL — a question nobody has screened at all — `pii_screen = 'clear'`
-- evaluates to NULL, not FALSE, so the whole expression is
-- `FALSE OR NULL` = NULL. **A Postgres CHECK constraint passes on NULL.**
-- Only an explicit FALSE fails it.
--
-- The effect was that the constraint refused a question screened
-- `needs_review` or `rejected`, and cheerfully allowed one that had never
-- been screened at all — the exact case `docs/18` §6 exists for. It looked
-- correct, it rejected two of the three wrong states, and the state it let
-- through was the most common one.
--
-- Found by the test that asserts the refusal rather than by reading the SQL.
-- A constraint that has only been watched rejecting the cases it does catch
-- has not been shown to catch the ones it misses.

ALTER TABLE campaign.question
  DROP CONSTRAINT question_approved_needs_clear_screen;

ALTER TABLE campaign.question
  ADD CONSTRAINT question_approved_needs_clear_screen CHECK (
    status <> 'approved' OR (pii_screen IS NOT NULL AND pii_screen = 'clear')
  );
