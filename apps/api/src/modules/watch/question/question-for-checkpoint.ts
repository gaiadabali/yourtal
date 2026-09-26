import type { Question } from "@yourtal/contracts/question/question";
import { selectQuestionsForSession } from "@yourtal/contracts/question/question-selection";

/**
 * Which question a given checkpoint asks. 5.2.b/c.
 *
 * `selectQuestionsForSession` (question-selection.ts) picks a whole
 * session's worth of questions from a bank in one call — the right shape
 * when every question could be asked at any checkpoint. Here each
 * checkpoint additionally has its OWN eligibility gate
 * (`answerableAfterSeconds`, 1.1.f: a question about the ending must not
 * fire at second 5), so this composes that function once per checkpoint
 * rather than once per session.
 *
 * Pure and deterministic, like the functions it calls — reloading mid-video
 * asks the same question at the same checkpoint, and no state is stored to
 * achieve it. Distinctness across a session's own checkpoints is enforced
 * by recomputing every EARLIER checkpoint's pick first and excluding it —
 * cheap at up to `MAX_QUESTIONS_ASKED` (5) checkpoints, and needs no table
 * of "questions already used in this session".
 */
export function pickQuestionForCheckpoint(
  bank: readonly Question[],
  sessionId: string,
  schedule: readonly number[],
  index: number,
  secret: string,
): Question | null {
  const used = new Set<string>();
  let picked: Question | null = null;

  for (let cursor = 0; cursor <= index; cursor += 1) {
    const atSecond = schedule[cursor];
    if (atSecond === undefined) {
      picked = null;
      continue;
    }

    const eligible = bank.filter(
      (question) => question.answerableAfterSeconds <= atSecond && !used.has(question.id),
    );
    const [pick] = selectQuestionsForSession({
      sessionId: `${sessionId}:checkpoint:${String(cursor)}`,
      bank: eligible,
      count: 1,
      secret,
    });
    // `selectQuestionsForSession` returns `PresentedQuestion`, which has no
    // key — so the pick is re-resolved by id against the SCORING bank
    // rather than trusted as-is. This is the one place the presented and
    // scoring forms are stitched back together, and only here.
    const scoring = pick === undefined ? undefined : eligible.find((question) => question.id === pick.id);
    picked = scoring ?? null;
    if (picked !== null) used.add(picked.id);
  }
  return picked;
}
