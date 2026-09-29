-- TASKS.md 11.5.i (requested by A for 10.4.a): the real per-question timing
-- signal (packages/contracts' question-response-signals) needs somewhere to
-- accumulate across a session's answers, because `yourtal_app` has INSERT
-- only on `campaign.question_response` (20260921233000's header) and cannot
-- re-SELECT latencies back out of it. `answer_latencies_ms` is this
-- session's own running list, appended once per answer by
-- `DrizzleQuestionAnswerRepository.recordAnswer`; `timing_suspicious` is the
-- sticky verdict `WatchController.complete` reads and forwards to the
-- ledger's RiskGate as `TimingSuspicious` — sticky (never cleared back to
-- false) because one bad answer is evidence for the whole session, not just
-- that answer.
ALTER TABLE watch.session
  ADD COLUMN timing_suspicious boolean NOT NULL DEFAULT false;

ALTER TABLE watch.session
  ADD COLUMN answer_latencies_ms jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 11.5.f: set when the real DeliveryCoverageReader (10.4.c) answers
-- `gap_detected` at completion — evidence a claimed span was never actually
-- served, surfaced for later fraud review. Never gates or delays the grant
-- (delivery-coverage.ts's own header): this is written AFTER `grantReward`
-- already ran, same as the response's own `deliveryCoverage` field.
ALTER TABLE watch.session
  ADD COLUMN delivery_gap_flagged_at timestamptz;
