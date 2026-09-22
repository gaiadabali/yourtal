-- YT-0125: the role that may read per-user checkpoint answers.
--
-- YT-0122's migration named this role and deliberately did not create it,
-- on the argument that inventing a boundary before the thing it protects
-- has a shape leaves it defended by nobody. YT-0125 is that shape, so the
-- role is created here with exactly the privileges its job needs.
--
-- ## This role IS the security boundary of `campaign.question_response`
--
-- `yourtal_app` holds INSERT and no SELECT on that table, which is what
-- makes "never exposed per-user to the business" structural rather than a
-- convention — every business surface is served by `yourtal_app`, so if it
-- cannot read the rows, no surface can render them.
--
-- That guarantee survives exactly as long as this role stays unreachable
-- from an HTTP handler. **The thing that must never be true: `yourtal_app`
-- is granted membership of `yourtal_analyst`, or an application connection
-- string uses it.** Either would dissolve the control with no schema
-- change for anyone to notice, because the grants below would still read
-- as deliberate. `question_response_constraints` asserts the negative.
--
-- ## What it can read, and the one thing it deliberately cannot
--
-- Leak detection needs the responses, the questions and the options. It
-- does **not** need `campaign.question_answer_key`, because correctness is
-- already scored onto each response row at write time (`was_correct`).
-- Withholding the key is not symbolic: an analysis process that could read
-- both the answers and the key is one compromise away from being able to
-- answer every question in the bank correctly.
--
-- ## Why it may write two columns and no others
--
-- YT-0125's criterion is that a sudden accuracy jump **auto-retires** the
-- question, so this cannot be read-only — retirement is a write. It is
-- narrowed to the two columns that express it, by column-level GRANT, so
-- the role cannot edit a prompt, change a timer, or alter which option is
-- correct. A role that can retire a question and nothing else can be
-- wrong; it cannot be catastrophic.
--
-- `retired` is not a delete (`question-bank.ts`): a deleted question takes
-- its own evidence with it, and the cohort that answered it could no
-- longer be identified afterwards — which is the other half of this
-- ticket.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yourtal_analyst') THEN
    CREATE ROLE yourtal_analyst LOGIN PASSWORD 'analyst_local_only';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA campaign TO yourtal_analyst;

-- The per-user rows `yourtal_app` cannot see. This grant is the reason the
-- application's missing SELECT is a boundary rather than an oversight.
GRANT SELECT ON campaign.question_response TO yourtal_analyst;

-- Context for a verdict: which question, which options, how many times
-- asked. Not the key.
GRANT SELECT ON campaign.question, campaign.question_option TO yourtal_analyst;

-- Retirement, and nothing else. Column-level, so the role cannot rewrite a
-- prompt or a timer.
GRANT UPDATE (status, retired_reason) ON campaign.question TO yourtal_analyst;
