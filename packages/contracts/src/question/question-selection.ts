import { createHmac } from "node:crypto";
import type { Question } from "./question";
import { type PresentedQuestion, toPresentedQuestion } from "./presented-question";

/**
 * Which questions a given viewer is asked, and in what order the options
 * appear. YT-0122.
 *
 * ## Why this takes `Question` and can only return `PresentedQuestion`
 *
 * The input carries answer keys; the output cannot express one. Selection
 * happens on the scoring form because that is what the bank holds, and
 * `toPresentedQuestion` is applied on the way out, so **there is no way to
 * call this function and receive a selected question with its key still
 * attached.** A version returning `Question[]` and leaving stripping to the
 * caller would work identically and fail open the first time somebody
 * forgot — the same "unrepresentable rather than excluded" argument
 * `publicListingSchema` makes for settlement value.
 *
 * ## Deterministic per session, unguessable without the secret
 *
 * The same session always draws the same questions in the same option
 * order. That is not a convenience: a viewer who reloads mid-checkpoint
 * must not get a different question, or refreshing becomes a way to shop
 * for an easier one. Nothing is stored to achieve it — the draw is a pure
 * function of the session id and a server secret, exactly as the checkpoint
 * schedule in `watch/watch-checkpoint-token.ts` is.
 *
 * Keyed by SESSION rather than by user or campaign. Per-campaign would give
 * every viewer the same questions, which is the 1x-bank failure
 * `question-bank.ts` describes. Per-user across sessions would let someone
 * who abandoned and restarted map the bank by repetition.
 *
 * ## Domain separation
 *
 * Selection and shuffling use one secret through different prefixes, and
 * both differ from the checkpoint token's. Without that, anything that can
 * request a question order for a chosen session id is an oracle for HMACs
 * under the token-signing key.
 */

const SELECT_DOMAIN = "yt:question:select:v1";
const SHUFFLE_DOMAIN = "yt:question:shuffle:v1";

/**
 * A deterministic byte stream for one purpose and one session.
 *
 * Successive HMACs of an incrementing counter, rather than one digest
 * consumed until it runs out: a 32-byte digest is 32 draws, and a bank
 * larger than that would silently start reusing bytes and correlate the
 * tail of the shuffle with its head.
 */
function* byteStream(domain: string, seed: string, secret: string): Generator<number, never, void> {
  for (let block = 0; ; block += 1) {
    const digest = createHmac("sha256", secret)
      .update(`${domain}.${seed}.${String(block)}`)
      .digest();
    for (const byte of digest) yield byte;
  }
}

/**
 * Fisher-Yates, drawing from `stream`.
 *
 * Rejection sampling rather than `byte % range`: the modulo is biased
 * toward low indices whenever 256 is not a multiple of the range, which
 * for a bank of 12 means the first four questions are drawn slightly more
 * often than the rest. Small, and exactly the kind of bias that makes a
 * "random" subset predictable in aggregate — which is what
 * `question-bank.ts`'s leak argument is about.
 */
function shuffled<T>(items: readonly T[], stream: Generator<number, never, void>): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const range = index + 1;
    const limit = 256 - (256 % range);
    let byte = stream.next().value;
    while (byte >= limit) byte = stream.next().value;

    const pick = byte % range;
    const here = result[index];
    const there = result[pick];
    // Both are in range by construction; the guard is for the compiler,
    // which cannot know that, and costs nothing at runtime.
    if (here !== undefined && there !== undefined) {
      result[index] = there;
      result[pick] = here;
    }
  }
  return result;
}

export interface QuestionSelectionInput {
  readonly sessionId: string;
  /** The campaign's approved bank. Order here does not affect the result. */
  readonly bank: readonly Question[];
  /** How many to ask. Fewer are returned if the bank cannot cover it. */
  readonly count: number;
  readonly secret: string;
}

/**
 * The questions this session is asked, with options already shuffled.
 *
 * Returns fewer than `count` when the bank is too small rather than
 * repeating one — a repeated question inside a single sitting is obvious
 * to the viewer and tells them the bank is exhausted, which is a hint
 * about the bank's size they should not get.
 */
export function selectQuestionsForSession(
  input: QuestionSelectionInput,
): readonly PresentedQuestion[] {
  if (input.count <= 0 || input.bank.length === 0) return [];

  const draw = byteStream(SELECT_DOMAIN, input.sessionId, input.secret);
  const chosen = shuffled(input.bank, draw).slice(0, Math.min(input.count, input.bank.length));

  return chosen.map((question) => shuffleOptions(question, input.sessionId, input.secret));
}

/**
 * Shuffles a question's options for this session.
 *
 * Seeded by session AND question id, so two questions in one sitting do not
 * share a permutation — with a session-only seed, learning the order of one
 * would give the order of the next.
 *
 * `true_false`, `likert` and `short_text` have no option list to permute
 * and are returned unchanged. A `likert` scale must NOT be shuffled: its
 * order is its meaning, and reversing it silently inverts every answer.
 */
function shuffleOptions(question: Question, sessionId: string, secret: string): PresentedQuestion {
  const presented = toPresentedQuestion(question);
  const stream = byteStream(SHUFFLE_DOMAIN, `${sessionId}:${question.id}`, secret);

  if (presented.type === "multiple_choice") {
    return { ...presented, options: shuffled(presented.options, stream) };
  }
  if (presented.type === "ranked") {
    // The items a viewer is asked to rank. Shuffling these is the point —
    // presenting them in the authored order would let the "correct" ranking
    // be guessed as "leave it alone".
    return { ...presented, items: shuffled(presented.items, stream) };
  }
  return presented;
}
