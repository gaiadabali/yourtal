import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANSWER_KEY_FIELDS } from "@yourtal/contracts/question/presented-question";
import { multipleChoiceFixture } from "./checkpoint-question-fixtures";

/**
 * EW-04, 5.2.e: the checkpoint feature must never ship the answer key to
 * the browser. Risk 46 was exactly this — `checkpoint-scoring.ts` (deleted)
 * imported the SCORING form of `Question` and read `correctOptionId`
 * client-side. The remaining presentational components (the per-type
 * `questions/*.tsx` views, `checkpoint-question-step.tsx`,
 * `question-answer-view.tsx`) already use `import type` only, which this
 * scans for directly rather than trusting it stays that way by convention —
 * `eslint.config.mjs`'s `@typescript-eslint/no-restricted-imports` block is
 * the enforcement; this is the proof.
 *
 * A static source scan, not a real bundler run: `next build`'s output is
 * expensive to produce in a unit test and this repo has no existing harness
 * for inspecting it. What actually matters — no VALUE import of the scoring
 * module, and no literal answer-key field or fixture id in a shipped file —
 * is fully checkable from source, since `import type` is erased before a
 * bundler ever sees it.
 */

const CHECKPOINT_DIR = join(__dirname);

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      files.push(...sourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.test\.(ts|tsx)$/.test(entry)) continue;
    // The fixtures file itself legitimately carries these fields — it is
    // TEST data (only ever imported by `.test.` files, never by production
    // code; see its own header) and is explicitly excluded from the scan
    // rather than silently matched.
    if (entry === "checkpoint-question-fixtures.ts") continue;
    if (entry === "no-answer-key-leak.test.ts") continue;
    files.push(full);
  }
  return files;
}

const PRODUCTION_FILES = sourceFiles(CHECKPOINT_DIR);

describe("the checkpoint feature never ships an answer key", () => {
  it("has at least one production source file to scan (a canary against an empty/misconfigured glob)", () => {
    expect(PRODUCTION_FILES.length).toBeGreaterThan(0);
  });

  it("imports @yourtal/contracts/question only as `import type`, never as a value", () => {
    const offenders: string[] = [];
    for (const file of PRODUCTION_FILES) {
      const text = readFileSync(file, "utf8");
      const lines = text.split("\n");
      for (const line of lines) {
        const namesQuestionModule =
          /from\s+["']@yourtal\/contracts\/question(\/question)?["']/.test(line);
        if (namesQuestionModule && !/^\s*import\s+type\s/.test(line)) {
          offenders.push(`${file}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toStrictEqual([]);
  });

  it("never carries the answer-key field names as a real property access or object key", () => {
    // Matches `correctOptionId:` / `.correctOptionId` / `["correctAnswer"]`
    // etc. — a property being READ or WRITTEN, not merely named in a type
    // position (`import type` lines are excluded above; a `type` field name
    // inside an interface/union this file might declare is not excluded,
    // because none of these files have any legitimate reason to declare one
    // at all — that shape belongs entirely to `@yourtal/contracts/question`).
    const offenders: string[] = [];
    for (const file of PRODUCTION_FILES) {
      const text = readFileSync(file, "utf8");
      for (const field of ANSWER_KEY_FIELDS) {
        const propertyPattern = new RegExp(`[.\\[]\\s*["']?${field}["']?|\\b${field}\\s*:`);
        if (propertyPattern.test(text)) {
          offenders.push(`${file} references ${field}`);
        }
      }
    }
    expect(offenders).toStrictEqual([]);
  });

  it("never hard-codes the seeded multiple_choice fixture's own answer-key option id", () => {
    // A boolean (`true_false`'s key) is too common a literal to search for
    // meaningfully; the fixture's option UUID is specific enough that its
    // appearance anywhere in production source is unambiguous evidence of
    // a leak, never a coincidence.
    const offenders = PRODUCTION_FILES.filter((file) =>
      readFileSync(file, "utf8").includes(multipleChoiceFixture.correctOptionId),
    );
    expect(offenders).toStrictEqual([]);
  });
});
