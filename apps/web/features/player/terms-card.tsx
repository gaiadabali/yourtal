import { asDisplayPoints, formatPointsIn } from "@yourtal/contracts/money/format";
import type { CampaignTerms } from "@yourtal/contracts/campaign/terms";
import { getPlayerTranslator, type SupportedLocale } from "./player-i18n";

export interface TermsCardProps {
  terms: CampaignTerms;
  locale: SupportedLocale;
}

/**
 * 11.5.a: absolute points from the CURRENT terms (never
 * the old `campaign-reward-split.ts`'s 0.6 placeholder ratio — deleted in
 * 11.5.a, since every real call site now reads its own genuine numbers
 * instead), the question count,
 * and the two facts F10/O-1 make non-negotiable: the reward is all-or-
 * nothing, and a new account's grant is held for review.
 */
export function TermsCard({ terms, locale }: TermsCardProps) {
  const t = getPlayerTranslator(locale);
  const maxPoints = terms.rewardPoints + terms.accuracyBonusPoints;
  const pointsLabel = formatPointsIn(locale, asDisplayPoints(maxPoints));

  return (
    <section
      aria-label={t("terms.ariaLabel")}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-4"
    >
      <p className="text-sm font-sans font-semibold text-fg">
        {terms.accuracyBonusPoints > 0
          ? t("terms.pointsWithBonus", { points: pointsLabel })
          : t("terms.points", { points: pointsLabel })}
      </p>
      <p className="text-sm font-sans text-fg-muted">
        {terms.questionCount > 0
          ? t("terms.questionCount", { count: terms.questionCount })
          : t("terms.noQuestions")}
      </p>
      <p className="text-sm font-sans text-fg-muted">{t("terms.stoppingEarly")}</p>
      <p className="text-xs font-sans text-fg-muted">{t("terms.newAccountHold")}</p>
    </section>
  );
}
