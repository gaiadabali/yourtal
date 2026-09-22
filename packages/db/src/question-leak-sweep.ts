import type pg from "pg";
import {
  type AnswerPattern,
  describeRetirement,
  identicalAnswerCohorts,
  judgeAccuracyJump,
} from "@yourtal/contracts/question/leak-signals";
import type { AnswerCohort } from "@yourtal/contracts/question/leak-signals";

/**
 * The sweep that turns leak signals into retirements. YT-0125.
 *
 * Runs as the ANALYST, never as the application. That is not a deployment
 * preference — `yourtal_app` has no SELECT on `campaign.question_response`,
 * and that missing grant is what makes "never exposed per-user to the
 * business" structural. A sweep running on the app's credential could not
 * read its own input, and one that was *given* the grant to fix that would
 * have dissolved the control it exists to serve.
 *
 * **It must therefore not run inside `apps/api`.** Not merely "no handler
 * calls it" — an API process holding an analyst pool is an API process that
 * CAN read those rows, and the guarantee was about the process, not about
 * anyone's discipline. Where it is scheduled from is a deployment decision
 * and is deliberately not made here; what is fixed is which credential it
 * holds and which one it must not.
 *
 * ## Two windows, split by time
 *
 * `judgeAccuracyJump` compares a recent window against a baseline rather
 * than against a running average, for the reason recorded there: an average
 * absorbs the leak it is meant to reveal. This supplies those windows by
 * splitting a question's answers at a cutoff — everything before it is the
 * baseline, everything after is recent.
 */

/** How far back "recent" reaches, by default. */
export const DEFAULT_RECENT_WINDOW_HOURS = 24;

export interface LeakSweepOptions {
  /** Server time the sweep runs at. Passed in so a test is not at the mercy of the clock. */
  readonly now: Date;
  readonly recentWindowHours?: number;
  /** Retire on a verdict, or only report. Dry run is the default. */
  readonly retire?: boolean;
}

export interface RetiredQuestion {
  readonly questionId: string;
  readonly reason: string;
  readonly cohorts: readonly AnswerCohort[];
}

export interface LeakSweepResult {
  readonly examined: number;
  readonly retired: readonly RetiredQuestion[];
}

interface WindowRow {
  readonly question_id: string;
  readonly baseline_answered: string;
  readonly baseline_correct: string;
  readonly recent_answered: string;
  readonly recent_correct: string;
}

/**
 * Examines every approved question and retires those whose population
 * accuracy has jumped.
 *
 * Returns what it found either way. `retire` defaults to **false**: a sweep
 * that retires on its first run in a new environment, before anyone has
 * looked at what it would do, is how a detector deletes a bank. The caller
 * opts in.
 */
export async function sweepForLeakedQuestions(
  analyst: pg.Pool,
  options: LeakSweepOptions,
): Promise<LeakSweepResult> {
  const hours = options.recentWindowHours ?? DEFAULT_RECENT_WINDOW_HOURS;
  const cutoff = new Date(options.now.getTime() - hours * 60 * 60 * 1_000);

  // One row per question, both windows counted in the database. Counting
  // here rather than streaming every response keeps the per-user rows
  // inside the query: the sweep only needs totals to reach a verdict, and
  // pulls individual answers only for a question that has already failed.
  const { rows } = await analyst.query<WindowRow>(
    `SELECT q.id AS question_id,
            count(*) FILTER (WHERE r.answered_at <  $1)::text AS baseline_answered,
            count(*) FILTER (WHERE r.answered_at <  $1 AND r.was_correct)::text AS baseline_correct,
            count(*) FILTER (WHERE r.answered_at >= $1)::text AS recent_answered,
            count(*) FILTER (WHERE r.answered_at >= $1 AND r.was_correct)::text AS recent_correct
       FROM campaign.question q
       JOIN campaign.question_response r ON r.question_id = q.id
      WHERE q.status = 'approved'
      GROUP BY q.id`,
    [cutoff],
  );

  const retired: RetiredQuestion[] = [];

  for (const row of rows) {
    const verdict = judgeAccuracyJump(
      { answered: Number(row.baseline_answered), correct: Number(row.baseline_correct) },
      { answered: Number(row.recent_answered), correct: Number(row.recent_correct) },
    );
    if (!verdict.leaked) continue;

    const reason = describeRetirement(verdict);
    const cohorts = await cohortsFor(analyst, row.question_id, cutoff);

    if (options.retire === true) {
      // Guarded by `status = 'approved'` so two concurrent sweeps cannot
      // both claim the retirement, and so a question retired for another
      // reason in between is not silently overwritten.
      await analyst.query(
        `UPDATE campaign.question
            SET status = 'retired', retired_reason = $2
          WHERE id = $1 AND status = 'approved'`,
        [row.question_id, reason],
      );
    }

    retired.push({ questionId: row.question_id, reason, cohorts });
  }

  return { examined: rows.length, retired };
}

/**
 * The accounts that answered this question in the recent window, grouped by
 * identical answer patterns.
 *
 * Scoped to the sessions that answered the *flagged* question rather than
 * to the whole population: a cohort is only interesting relative to the
 * leak that exposed it, and clustering everybody would return groups that
 * have nothing to do with it.
 */
async function cohortsFor(
  analyst: pg.Pool,
  questionId: string,
  cutoff: Date,
): Promise<readonly AnswerCohort[]> {
  const { rows } = await analyst.query<{
    session_id: string;
    question_id: string;
    answer: string;
  }>(
    `SELECT r.session_id, r.question_id,
            coalesce(r.selected_option_id::text, r.answered_bool::text) AS answer
       FROM campaign.question_response r
      WHERE r.session_id IN (
              SELECT session_id FROM campaign.question_response
               WHERE question_id = $1 AND answered_at >= $2
            )`,
    [questionId, cutoff],
  );

  const bySession = new Map<string, Map<string, string>>();
  for (const row of rows) {
    const answers = bySession.get(row.session_id) ?? new Map<string, string>();
    answers.set(row.question_id, row.answer);
    bySession.set(row.session_id, answers);
  }

  const patterns: AnswerPattern[] = [...bySession].map(([sessionId, answers]) => ({
    accountId: sessionId,
    answers,
  }));
  return identicalAnswerCohorts(patterns);
}
