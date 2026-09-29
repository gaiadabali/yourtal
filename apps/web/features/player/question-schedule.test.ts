import { describe, expect, it } from "vitest";
import { questionsAskedFor as authoritative } from "@yourtal/contracts/question/question-bank";
import { questionsAskedFor as clientCopy } from "./question-schedule";

/**
 * This file may `import type` from `@yourtal/contracts/question/question-bank`
 * or, as here, take a runtime import in a `.test.ts` — the eslint boundary
 * (EW-04/5.2.e) applies to the shipped browser bundle, not to a test file
 * that never ships. Proves `question-schedule.ts`'s cosmetic copy has not
 * drifted from the one `checkpoint.controller.ts` actually enforces.
 */
describe("question-schedule's client copy matches the authoritative F10 formula", () => {
  it.each([0, 1, 30, 59, 60, 90, 299, 300, 600, 900, 1_500, 3_600, 10_800])(
    "durationSeconds=%i",
    (durationSeconds) => {
      expect(clientCopy(durationSeconds)).toBe(authoritative(durationSeconds));
    },
  );
});
