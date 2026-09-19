import type { Campaign } from "@yourtal/contracts/campaign";
import { getCampaignTranslator, type SupportedLocale } from "./campaign-i18n";

/**
 * Plain-language scoring-rule copy for the entry card (YT-0411). Kept as a
 * pure, table-driven function so the wording is exhaustive over
 * `CampaignScoringRule` and a new rule added to the contract fails this
 * file to compile, per docs/13b-typescript-standards.md §4's exhaustiveness
 * discipline.
 *
 * YT-0405: takes an optional `locale`, defaulting to `id-ID` so existing
 * callers are unaffected, and reads its copy from the `campaign` message
 * catalogue via `campaign-i18n.ts` rather than a second hand-rolled
 * per-locale string map.
 */
export function describeScoringRule(
  scoringRule: Campaign["scoringRule"],
  locale: SupportedLocale = "id-ID",
): string {
  const t = getCampaignTranslator(locale);
  switch (scoringRule) {
    case "base_only":
      return t("entry.scoringBaseOnly");
    case "base_plus_accuracy_bonus":
      return t("entry.scoringBaseBonus");
    default: {
      const exhaustive: never = scoringRule;
      throw new Error(`Unhandled scoring rule: ${String(exhaustive)}`);
    }
  }
}

/** Question-count copy that reads naturally at zero, one, or many questions. */
export function describeQuestionCount(
  questionCount: number,
  locale: SupportedLocale = "id-ID",
): string {
  const t = getCampaignTranslator(locale);
  if (questionCount === 0) {
    return t("entry.zeroQuestions");
  }
  return questionCount === 1
    ? t("entry.oneQuestion")
    : t("entry.manyQuestions", { count: questionCount });
}
