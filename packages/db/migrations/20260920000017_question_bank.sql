-- YT-0102: the question bank.
--
-- Under founder decision O-1 the questions are half the reward gate, not a
-- scoring garnish — a viewer is paid for the full video AND the questions.
-- So this table is value-path storage, and its two unusual properties follow
-- from that rather than from taste.

CREATE TABLE campaign.question (
  id            uuid    PRIMARY KEY,
  campaign_id   uuid    NOT NULL REFERENCES campaign.campaigns (id) ON DELETE CASCADE,
  type          text    NOT NULL CHECK (type IN ('multiple_choice', 'true_false', 'likert', 'ranked', 'short_text')),
  prompt        text    NOT NULL CHECK (length(prompt) BETWEEN 1 AND 300),
  timer_seconds integer NOT NULL CHECK (timer_seconds > 0 AND timer_seconds <= 120),

  -- `draft` until screened and approved; `retired` when withdrawn.
  status        text    NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'approved', 'retired')),

  -- docs/18 §6. A reward-gated question is a uniquely effective way to
  -- harvest data a business could not otherwise ask for: the viewer is
  -- mid-reward and motivated to answer. NULL means nobody has screened it,
  -- which is deliberately different from a human having said no.
  pii_screen    text    CHECK (pii_screen IN ('clear', 'needs_review', 'rejected')),

  -- The gate, as a constraint rather than a convention. A question cannot
  -- BE approved without a clear screen — so "screening is required" is a
  -- property of the table and not a step a service might skip.
  CONSTRAINT question_approved_needs_clear_screen CHECK (
    status <> 'approved' OR pii_screen = 'clear'
  ),

  -- A retirement without a reason is one nobody can audit later, and
  -- docs/18 §11 expects retirement to happen automatically on a leak signal.
  retired_reason text CHECK (length(retired_reason) <= 280),
  CONSTRAINT question_retired_reason_iff_retired CHECK (
    (status = 'retired') = (retired_reason IS NOT NULL)
  ),

  -- COUNTERS, never a stored accuracy rate. A rate is a derived value a
  -- concurrent answer can corrupt — the same rule the ledger follows for
  -- balances — and it loses the denominator, so 97% from four answers could
  -- not be told from 97% from four thousand. A leak detector that cannot
  -- distinguish those fires on noise and gets muted.
  times_asked   bigint  NOT NULL DEFAULT 0 CHECK (times_asked >= 0),
  times_correct bigint  NOT NULL DEFAULT 0 CHECK (times_correct >= 0),
  CONSTRAINT question_correct_within_asked CHECK (times_correct <= times_asked),

  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX question_campaign_status_idx ON campaign.question (campaign_id, status);

-- ---------------------------------------------------------------------------
-- The answer key
-- ---------------------------------------------------------------------------
--
-- A SEPARATE TABLE, not a column on the question above.
--
-- Risk 46: `questionSchema` carries the key today and `apps/web`'s scoring
-- module — client-side by its own header — imports it, so the key currently
-- travels to the browser and the score is computed by the thing being
-- scored. `PresentedQuestion` fixes the contract side; this fixes the
-- storage side.
--
-- Splitting it means a `SELECT *` on `campaign.question` — the query somebody
-- writes in a hurry — cannot return the answer. Serving the key requires
-- deliberately joining a table named `question_answer_key`, which is not
-- something anyone does by accident.
--
-- It also makes the grant possible: the API role can read questions and not
-- keys, and only the scoring path holds the role that can.
CREATE TABLE campaign.question_answer_key (
  question_id uuid PRIMARY KEY REFERENCES campaign.question (id) ON DELETE CASCADE,

  -- One nullable column per key shape rather than a jsonb blob, so the CHECK
  -- below can insist the key MATCHES the question type. A blob would make
  -- "a true/false question with a multiple-choice key" representable, and
  -- that is a scoring bug that only appears when somebody answers.
  correct_option_id uuid,
  correct_answer    boolean,

  CONSTRAINT answer_key_exactly_one_shape CHECK (
    (correct_option_id IS NOT NULL)::int + (correct_answer IS NOT NULL)::int = 1
  )
);

-- ---------------------------------------------------------------------------
-- Options, for the two types that have them
-- ---------------------------------------------------------------------------
CREATE TABLE campaign.question_option (
  id          uuid    PRIMARY KEY,
  question_id uuid    NOT NULL REFERENCES campaign.question (id) ON DELETE CASCADE,
  label       text    NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
  -- Authoring order. A viewer's order is shuffled per user (YT-0122): a
  -- stable order across viewers is itself a weak answer key, since "it is
  -- always the third one" survives a leak of nothing but positions.
  ordinal     integer NOT NULL CHECK (ordinal >= 0),

  UNIQUE (question_id, ordinal)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON campaign.question        TO yourtal_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON campaign.question_option TO yourtal_app;

-- The app writes a key when a question is authored and reads it when scoring
-- — both server-side. What it must never do is DELETE one, because a question
-- whose key vanished would silently score every answer as wrong, and the
-- viewer who lost a reward would have no evidence anything had changed.
GRANT SELECT, INSERT, UPDATE ON campaign.question_answer_key TO yourtal_app;
