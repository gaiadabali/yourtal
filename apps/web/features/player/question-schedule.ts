/**
 * F10's question-count formula, mirrored client-side.
 *
 * The authoritative version lives in
 * `@yourtal/contracts/question/question-bank`'s `questionsAskedFor`, and
 * `checkpoint.controller.ts` is what actually enforces it — this copy is
 * cosmetic only (it tells `use-watch-earn-session.ts` when to stop polling
 * for another checkpoint and lets the overlay show "Question X of Y"). It
 * cannot import the real one: `eslint.config.mjs`'s EW-04/5.2.e rule
 * restricts every runtime import under `@yourtal/contracts/question/*` in
 * apps/web except `presented-question` (the answer-key-bearing scoring form
 * lives one directory up), directory-wide rather than file-by-file, so this
 * carries-no-secret pure function is caught by the same boundary as the one
 * that does.
 *
 * "d < 60 asks none; 60s to under 10 minutes asks exactly one; longer asks
 * one per five minutes, capped at five."
 */
const NO_QUESTIONS_BELOW_SECONDS = 60;
const SECONDS_PER_QUESTION = 5 * 60;
const MAX_QUESTIONS_ASKED = 5;

export function questionsAskedFor(durationSeconds: number): number {
  if (durationSeconds < NO_QUESTIONS_BELOW_SECONDS) return 0;
  return Math.max(
    1,
    Math.min(MAX_QUESTIONS_ASKED, Math.floor(durationSeconds / SECONDS_PER_QUESTION)),
  );
}
