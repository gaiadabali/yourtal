-- YT-0122: answers stored against the campaign, never exposed per-user to
-- the business.
--
-- The criterion is a property, not a mechanism, so it is implemented as one
-- the database enforces rather than as a rule a service follows. A service
-- check is something every future caller can forget, and the forgetting is
-- silent. A missing SELECT cannot be forgotten by anyone, including callers
-- nobody has written yet.
--
-- ## `yourtal_app` may INSERT and may not SELECT
--
-- The application records an answer and can never read one back. That is
-- what makes "never exposed per-user to the business" structural: every
-- business-facing surface is served by `yourtal_app`, so if the role cannot
-- read the rows, no surface can render them — no matter what a future
-- endpoint tries to do.
--
-- Same shape as `watch.coverage` and `voucher.code_custody`: the guarantee
-- lives in the grant, and YT-0044's tamper test has to outrank the role to
-- even attempt a violation.
--
-- ## The business still gets its answer, in aggregate
--
-- `campaign.question.times_asked` and `times_correct` already exist and
-- `yourtal_app` can read and update both. That is the "stored against the
-- campaign" half: a merchant learns that 61% of viewers got question 3
-- right, which is what they have a legitimate interest in, and cannot learn
-- what any one person answered, which they do not.
--
-- ## ⚠️ The role that CAN read these rows does not exist yet
--
-- YT-0125 (answer-key leak detection) needs per-user rows — its whole job is
-- clustering accounts that answer identical subsets identically, and
-- population accuracy over time is what retires a leaked question. So some
-- role must eventually hold the SELECT that `yourtal_app` lacks.
--
-- **That role is the entire security boundary of this table.** The moment it
-- is granted to anything a business surface can reach, this control
-- evaporates with no schema change for anyone to notice — the grant would
-- still read as deliberate. What must never be true: the analysis role is
-- never the role any HTTP handler connects as, and is never granted to
-- `yourtal_app`. It is named here rather than created, because creating it
-- before YT-0125 has a shape would be inventing a boundary nobody is
-- defending yet.

CREATE TABLE campaign.question_response (
  id                 bigserial   PRIMARY KEY,

  session_id         uuid        NOT NULL REFERENCES watch.session (id),
  question_id        uuid        NOT NULL REFERENCES campaign.question (id),

  -- Exactly one of these carries the answer, depending on the question's
  -- type. Both nullable because neither applies to every type, and the
  -- CHECK below is what stops a row carrying an answer in no field at all.
  selected_option_id uuid        REFERENCES campaign.question_option (id),
  answered_bool      boolean,

  -- Scored at write time, because scoring needs the answer key and the key
  -- is exactly what must not be readable beside the response afterwards.
  was_correct        boolean     NOT NULL,

  -- Server-measured, from delivery to receipt. Never the client's own
  -- timing: the whole point is that a client cannot report its way out of
  -- looking automated.
  latency_ms         integer     NOT NULL CHECK (latency_ms >= 0),

  answered_at        timestamptz NOT NULL DEFAULT now(),

  -- One answer per question per session. The checkpoint nonce table already
  -- enforces one answer per CHECKPOINT; this is the same rule one level
  -- down, so a second answer to the same question cannot arrive through
  -- some future path that does not go via a checkpoint token.
  CONSTRAINT question_answered_once_per_session UNIQUE (session_id, question_id),

  -- A response with no answer in it is not a response. Without this, a
  -- `was_correct = false` row with both answer columns null is indis-
  -- tinguishable from a wrong answer, and the leak analysis that reads
  -- these rows would score it as one.
  CONSTRAINT question_response_carries_an_answer CHECK (
    (selected_option_id IS NOT NULL) <> (answered_bool IS NOT NULL)
  )
);

-- How YT-0125 will read: every response to one question, over time.
CREATE INDEX question_response_by_question ON campaign.question_response (question_id, answered_at);

-- INSERT and nothing else. No SELECT is the control; no UPDATE because a
-- scored answer is a fact about a moment and there is nothing to amend; no
-- DELETE because the evidence outlives the session that produced it.
GRANT INSERT ON campaign.question_response TO yourtal_app;
GRANT USAGE, SELECT ON SEQUENCE campaign.question_response_id_seq TO yourtal_app;
