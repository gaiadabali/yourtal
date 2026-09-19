import type { QuestionOption } from "@yourtal/contracts/question";

/**
 * The authoring-time shape of a question, one file per contract concept
 * (docs/13b-typescript-standards.md §6). `QuestionDraft` mirrors
 * `@yourtal/contracts/question`'s five-member discriminated union field for
 * field, so a finished draft can be handed straight to `questionSchema`
 * at publish time without a second parallel shape drifting from the first
 * (§3: "the same schema drives the form, never a hand-written parallel
 * shape"). It only ever `import type`s from `@yourtal/contracts/question` —
 * never the package's `questionSchema` value, which is a Zod (full) schema:
 * a value import would drag ~96 KB gz of Zod into this client-reachable
 * module (§8's 200 KB budget), on top of the framework's own ~147 KB floor.
 * No schema runs at all in this file — every draft field is validated by
 * the plain functions in `question-pii-guard.ts`/`question-bank-actions.ts`
 * instead, so there is nothing here for `zod/mini` to usefully do.
 *
 * `id`/`campaignId` are plain `string` here, not the contract's `z.uuid()`
 * brand — an in-progress draft does not need a validated UUID to exist in
 * memory, only when it is finally parsed against `questionSchema` at
 * publish time (a step outside this ticket's mock-only scope, same as
 * `campaign-draft.ts`).
 */
export const QUESTION_TYPES = [
  "multiple_choice",
  "true_false",
  "likert",
  "ranked",
  "short_text",
] as const;
export type QuestionDraftType = (typeof QUESTION_TYPES)[number];

export interface QuestionDraftOption {
  id: string;
  label: string;
}
// Compile-time proof this stays structurally identical to the contract's
// own option shape (`{ id, label }`, both strings) without a runtime import
// of it — `QuestionOption`'s `id` is `z.uuid()`, which infers as `string`,
// so the two are directly comparable, no branding involved. Prefixed `_`
// (unused-by-design) since its only job is to fail `tsc` if the two shapes
// ever diverge.
const _optionShapeCheck: QuestionDraftOption = { id: "", label: "" } satisfies QuestionOption;

export interface MultipleChoiceQuestionDraft {
  id: string;
  campaignId: string;
  type: "multiple_choice";
  prompt: string;
  timerSeconds: number;
  options: QuestionDraftOption[];
  correctOptionId: string | null;
}

export interface TrueFalseQuestionDraft {
  id: string;
  campaignId: string;
  type: "true_false";
  prompt: string;
  timerSeconds: number;
  correctAnswer: boolean | null;
}

export interface LikertQuestionDraft {
  id: string;
  campaignId: string;
  type: "likert";
  prompt: string;
  timerSeconds: number;
  scaleMin: number;
  scaleMax: number;
  scaleLowLabel: string;
  scaleHighLabel: string;
}

export interface RankedQuestionDraft {
  id: string;
  campaignId: string;
  type: "ranked";
  prompt: string;
  timerSeconds: number;
  items: QuestionDraftOption[];
}

export interface ShortTextQuestionDraft {
  id: string;
  campaignId: string;
  type: "short_text";
  prompt: string;
  timerSeconds: number;
  maxLength: number;
}

export type QuestionDraft =
  | MultipleChoiceQuestionDraft
  | TrueFalseQuestionDraft
  | LikertQuestionDraft
  | RankedQuestionDraft
  | ShortTextQuestionDraft;

/**
 * Scored vs opinion, per docs/06-longform-video-and-attention.md §4.1's
 * table: multiple choice and true/false have a correct answer and are
 * scored; Likert, ranked and short text are opinion/feedback and are never
 * scored. Exhaustive `switch` with a `never` default (docs/13b §4's
 * discipline) so a sixth question type breaks this file's build rather than
 * silently defaulting to "unscored".
 */
export function isScoredQuestionType(type: QuestionDraftType): boolean {
  switch (type) {
    case "multiple_choice":
    case "true_false":
      return true;
    case "likert":
    case "ranked":
    case "short_text":
      return false;
    default: {
      const exhaustive: never = type;
      throw new Error(`Unhandled question type: ${String(exhaustive)}`);
    }
  }
}

const DEFAULT_TIMER_SECONDS = 25;

/** Maps a specific type literal to its own draft interface, so `createEmptyQuestionDraft("true_false", ...)` gives callers a `TrueFalseQuestionDraft`, not the full five-member union they would then have to narrow themselves. */
type QuestionDraftOfType<T extends QuestionDraftType> = Extract<QuestionDraft, { type: T }>;

/** A fresh, empty draft of the given type — `idFactory` is injectable so tests get deterministic ids. */
export function createEmptyQuestionDraft<T extends QuestionDraftType>(
  type: T,
  campaignId: string,
  idFactory: () => string = () => crypto.randomUUID(),
): QuestionDraftOfType<T> {
  const id = idFactory();
  const shared = { id, campaignId, prompt: "", timerSeconds: DEFAULT_TIMER_SECONDS };
  // `type` is the generic `T`, not a literal the switch can narrow — each
  // branch below is provably the right shape for its own `case`, so the
  // cast to `QuestionDraftOfType<T>` only restates what the switch already
  // guarantees, never bypasses it.
  switch (type) {
    case "multiple_choice":
      return {
        ...shared,
        type,
        options: [
          { id: idFactory(), label: "" },
          { id: idFactory(), label: "" },
        ],
        correctOptionId: null,
      } as QuestionDraftOfType<T>;
    case "true_false":
      return { ...shared, type, correctAnswer: null } as QuestionDraftOfType<T>;
    case "likert":
      return {
        ...shared,
        type,
        scaleMin: 1,
        scaleMax: 5,
        scaleLowLabel: "",
        scaleHighLabel: "",
      } as QuestionDraftOfType<T>;
    case "ranked":
      return {
        ...shared,
        type,
        items: [
          { id: idFactory(), label: "" },
          { id: idFactory(), label: "" },
        ],
      } as QuestionDraftOfType<T>;
    case "short_text":
      return { ...shared, type, maxLength: 200 } as QuestionDraftOfType<T>;
    default: {
      const exhaustive: never = type;
      throw new Error(`Unhandled question type: ${String(exhaustive)}`);
    }
  }
}
