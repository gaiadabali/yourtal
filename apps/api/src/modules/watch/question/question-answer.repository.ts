import { eq, sql } from "drizzle-orm";
import type { Question } from "@yourtal/contracts/question/question";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { watchSessions } from "../persistence/schema/watch.table";

export const QUESTION_ANSWER_REPOSITORY = Symbol("QUESTION_ANSWER_REPOSITORY");

export interface AnswerQuestionInput {
  readonly sessionId: string;
  /** The scoring form — carries the key, never sent to a client. */
  readonly question: Question;
  readonly selectedOptionId: string | null;
  readonly answeredBool: boolean | null;
  /** Server-measured, from issuance to receipt. Never the client's own timing. */
  readonly latencyMs: number;
  /** 5.2.d: a timeout scores wrong regardless of the answer. */
  readonly timedOut: boolean;
}

/**
 * Scores an answer server-side and writes it, all in one place. 5.2.d,
 * EW-04, EW-09.
 *
 * Writes THREE things in one transaction: the response itself
 * (`campaign.question_response`, INSERT-only for `yourtal_app` by design —
 * 20260921233000's header explains why), the campaign's own aggregate
 * counters (`campaign.question`, which the app CAN read and update — this
 * is the "stored against the campaign, never per-user" half), and this
 * SESSION's running `questions_asked`/`questions_correct` — the counters
 * `WatchController.complete` actually reads, because it cannot read
 * `question_response` back (EW-09's point: the answered-once record lives
 * in a table that is never pruned, and is never re-SELECTed either).
 */
export interface QuestionAnswerRepository {
  recordAnswer(input: AnswerQuestionInput): Promise<{ wasCorrect: boolean }>;
}

export class DrizzleQuestionAnswerRepository implements QuestionAnswerRepository {
  constructor(private readonly db: AppDb) {}

  async recordAnswer(input: AnswerQuestionInput): Promise<{ wasCorrect: boolean }> {
    const correctAgainstKey = scoreAgainstKey(input.question, input.selectedOptionId, input.answeredBool);
    // "Timeout = answered wrong, never voids" (TASKS.md 5.2). The server's
    // own clock overrides whatever the answer said.
    const wasCorrect = !input.timedOut && correctAgainstKey;

    await this.db.transaction(async (tx) => {
      // NOT `ON CONFLICT ... RETURNING`: `yourtal_app` has INSERT and
      // NOTHING else on `campaign.question_response` (20260921233000's own
      // header explains why — the no-SELECT grant is the whole security
      // boundary), and `RETURNING` needs SELECT on the columns it returns
      // regardless of `ON CONFLICT`. So a plain INSERT, and the UNIQUE
      // violation (`question_answered_once_per_session`) is caught instead
      // of detected via a returned row. It backstops the checkpoint-token
      // nonce (which already guarantees one answer per CHECKPOINT) in case
      // two different checkpoints ever resolved to the same question —
      // belt and braces, not the primary control.
      try {
        await tx.execute(sql`
          INSERT INTO campaign.question_response
            (session_id, question_id, selected_option_id, answered_bool, was_correct, latency_ms)
          VALUES (${input.sessionId}, ${input.question.id}, ${input.selectedOptionId},
                  ${input.answeredBool}, ${wasCorrect}, ${Math.max(0, Math.round(input.latencyMs))})
        `);
      } catch (error) {
        if (isUniqueViolation(error)) {
          // Already answered. Nothing else should be double-counted either.
          return;
        }
        throw error;
      }

      await tx.execute(sql`
        UPDATE campaign.question
           SET times_asked = times_asked + 1,
               times_correct = times_correct + ${wasCorrect ? 1 : 0}
         WHERE id = ${input.question.id}
      `);

      await tx
        .update(watchSessions)
        .set({
          questionsAsked: sql`${watchSessions.questionsAsked} + 1`,
          questionsCorrect: sql`${watchSessions.questionsCorrect} + ${wasCorrect ? 1 : 0}`,
        })
        .where(eq(watchSessions.id, input.sessionId));
    });

    return { wasCorrect };
  }
}

/** Postgres SQLSTATE 23505 (unique_violation), narrowed without an `as`. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "23505"
  );
}

function scoreAgainstKey(
  question: Question,
  selectedOptionId: string | null,
  answeredBool: boolean | null,
): boolean {
  if (question.type === "multiple_choice") {
    return selectedOptionId !== null && selectedOptionId === question.correctOptionId;
  }
  if (question.type === "true_false") {
    return answeredBool !== null && answeredBool === question.correctAnswer;
  }
  // likert/ranked/short_text never reach here — `QuestionBankRepository`
  // only ever returns multiple_choice/true_false (see its own comment).
  return false;
}
