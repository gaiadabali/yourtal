/**
 * Detecting that an answer key has leaked. YT-0125.
 *
 * `docs/18` §11 states the assumption this is built on: **the key will
 * leak.** Not "might" — a question asked enough times in public is a
 * question whose answer is eventually posted somewhere. So the design goal
 * is not prevention, it is *noticing quickly and responding automatically*,
 * because a leak noticed by a human three weeks later has already paid out.
 *
 * ## Population accuracy is the signal, and it works because most people
 * ## are honest
 *
 * A leaked question does not make one account suspicious — it makes the
 * *population* suddenly good at something it was mediocre at. That is only
 * visible if the bank is large enough that unknowing viewers still meet the
 * question (`question-bank.ts`'s 3x rule), which is why that ratio and this
 * detector are the same mechanism seen from two ends.
 *
 * ## Nothing here decides anything either
 *
 * Same rule as `question-response-signals.ts`: these return verdicts and
 * cohorts, never suspensions. `docs/18` §11 requires a flagged cohort to be
 * reviewed rather than silently zeroed, and `retired` is explicitly not a
 * delete — a deleted question takes its own evidence with it, and the
 * cohort that answered it could no longer be identified afterwards.
 */

/**
 * Accuracy must rise by at least this much to count as a jump.
 *
 * `docs/18` §11's worked example is 61% to 97% overnight. The threshold is
 * well below that because a leak does not have to be total to be worth
 * acting on — a partial answer key, or one shared inside a small group,
 * moves the number less and is the same problem.
 */
export const LEAK_ACCURACY_JUMP = 0.25;

/**
 * Answers needed in EACH window before a comparison means anything.
 *
 * The most dangerous version of this detector is one that fires on small
 * numbers: three lucky viewers in an hour look exactly like a leak, and a
 * rule that retires a question on that evidence hands anybody a way to
 * delete a campaign's bank by answering it well a few times.
 */
export const MIN_WINDOW_ANSWERS = 20;

export interface AccuracyWindow {
  readonly answered: number;
  readonly correct: number;
}

export type LeakVerdict =
  | { readonly leaked: false; readonly reason: "insufficient_data" | "no_jump" }
  | {
      readonly leaked: true;
      readonly baselineAccuracy: number;
      readonly recentAccuracy: number;
      readonly jump: number;
    };

function accuracyOf(window: AccuracyWindow): number | null {
  if (window.answered <= 0) return null;
  return window.correct / window.answered;
}

/**
 * Compares a recent window against the question's established baseline.
 *
 * Deliberately two windows rather than a running average. A running average
 * *absorbs* a leak — every leaked answer drags the mean toward the new
 * normal, so the very signal being watched for erodes the thing it is
 * measured against. Holding the baseline separate means a leak stays
 * visible for as long as it is happening.
 */
export function judgeAccuracyJump(baseline: AccuracyWindow, recent: AccuracyWindow): LeakVerdict {
  if (baseline.answered < MIN_WINDOW_ANSWERS || recent.answered < MIN_WINDOW_ANSWERS) {
    return { leaked: false, reason: "insufficient_data" };
  }

  const baselineAccuracy = accuracyOf(baseline);
  const recentAccuracy = accuracyOf(recent);
  if (baselineAccuracy === null || recentAccuracy === null) {
    return { leaked: false, reason: "insufficient_data" };
  }

  const jump = recentAccuracy - baselineAccuracy;
  if (jump < LEAK_ACCURACY_JUMP) {
    return { leaked: false, reason: "no_jump" };
  }
  return { leaked: true, baselineAccuracy, recentAccuracy, jump };
}

/** Why a question was retired, in the words stored on the row. */
export function describeRetirement(verdict: Extract<LeakVerdict, { leaked: true }>): string {
  const percent = (value: number) => `${String(Math.round(value * 100))}%`;
  return (
    `Population accuracy rose from ${percent(verdict.baselineAccuracy)} to ` +
    `${percent(verdict.recentAccuracy)} (+${percent(verdict.jump)}). Auto-retired by YT-0125; ` +
    `the cohort that answered in the recent window is flagged for review, not actioned.`
  );
}

export interface AnswerPattern {
  /** Who answered. Never leaves the analysis boundary — see the migration's note. */
  readonly accountId: string;
  /** Question id to the option (or boolean) chosen, for the questions this account saw. */
  readonly answers: ReadonlyMap<string, string>;
}

export interface AnswerCohort {
  readonly accountIds: readonly string[];
  /** The shared question set, sorted, so two cohorts are comparable. */
  readonly questionIds: readonly string[];
}

/**
 * Accounts that answered an identical subset identically.
 *
 * The criterion says *identical subsets identically*, and both halves
 * matter. Per-session selection means two honest viewers rarely see the
 * same questions at all (`question-selection.ts`), so **sharing a subset is
 * already unusual** — and answering that shared subset the same way, option
 * for option, is what a group working from one key looks like.
 *
 * Singletons are not returned. One account answering its own questions its
 * own way is every honest viewer, and a "cohort" of one would make the
 * output useless by burying the real groups.
 *
 * Accounts with no answers are excluded rather than grouped together: they
 * all trivially share the empty subset, and a cohort of everyone who has
 * answered nothing is an artefact of the grouping, not a finding.
 */
export function identicalAnswerCohorts(
  patterns: readonly AnswerPattern[],
): readonly AnswerCohort[] {
  const groups = new Map<string, { accountIds: string[]; questionIds: string[] }>();

  for (const pattern of patterns) {
    const questionIds = [...pattern.answers.keys()].sort();
    if (questionIds.length === 0) continue;

    // The fingerprint is question AND answer, in a fixed order — two
    // accounts that saw the same questions and disagreed on one are not a
    // cohort, which is the whole point of matching on answers rather than
    // on which questions were served.
    const fingerprint = questionIds
      .map((questionId) => `${questionId}=${pattern.answers.get(questionId) ?? ""}`)
      .join("|");

    const existing = groups.get(fingerprint);
    if (existing) {
      existing.accountIds.push(pattern.accountId);
    } else {
      groups.set(fingerprint, { accountIds: [pattern.accountId], questionIds });
    }
  }

  return [...groups.values()]
    .filter((group) => group.accountIds.length > 1)
    .map((group) => ({
      accountIds: [...group.accountIds].sort(),
      questionIds: group.questionIds,
    }));
}
