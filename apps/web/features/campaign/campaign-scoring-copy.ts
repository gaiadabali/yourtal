import type { Campaign } from "@yourtal/contracts/campaign";

/**
 * Plain-language scoring-rule copy for the entry card (YT-0411). Kept as a
 * pure, table-driven function so the wording is exhaustive over
 * `CampaignScoringRule` and a new rule added to the contract fails this
 * file to compile, per docs/13b-typescript-standards.md §4's exhaustiveness
 * discipline.
 */
export function describeScoringRule(scoringRule: Campaign["scoringRule"]): string {
  switch (scoringRule) {
    case "base_only":
      return "Reward penuh diberikan untuk menonton dan menjawab, tanpa syarat jawaban benar.";
    case "base_plus_accuracy_bonus":
      return "Reward dasar diberikan untuk menonton dan menjawab; bonus tambahan mengikuti jumlah jawaban yang benar.";
    default: {
      const exhaustive: never = scoringRule;
      throw new Error(`Unhandled scoring rule: ${String(exhaustive)}`);
    }
  }
}

/** Question-count copy that reads naturally at zero, one, or many questions. */
export function describeQuestionCount(questionCount: number): string {
  if (questionCount === 0) {
    return "Tidak ada pertanyaan";
  }
  return questionCount === 1 ? "1 pertanyaan" : `${questionCount} pertanyaan`;
}
