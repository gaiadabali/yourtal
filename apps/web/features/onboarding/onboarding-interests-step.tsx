"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Section } from "@yourtal/ui/section";
import { ChoiceCard } from "@yourtal/ui/choice-card";
import { Text } from "@yourtal/ui/text";
import { Button } from "@yourtal/ui/button";
import { ME_INTEREST_CATEGORIES } from "@/features/me/me-interest-catalogue";
import { updateInterestsAction } from "@/features/me/me-actions";
import { useMeActionStatus } from "@/features/me/use-me-action-status";
import { measureOnboardingDuration, recordOnboardingMark } from "./onboarding-timing";
import { withReturnTo } from "./onboarding-return-to";

export interface OnboardingInterestsStepProps {
  initialNodeIds: readonly string[];
  returnTo: string | null;
}

/**
 * Shown only when the consent step granted `declared_interest_targeting`
 * (`onboarding/interests/page.tsx` redirects away otherwise, and says so in
 * its own intro copy). The real taxonomy's root categories
 * (`me-interest-catalogue.ts`, the same list Me's own interests section
 * uses) rather than onboarding's old hand-duplicated one, which included
 * terms the taxonomy would reject as real nodes — see that catalogue's own
 * doc comment. Saved live on every toggle (`PUT /api/me/interests`, reused
 * from Me as-is), not carried as unsaved local state to a final "submit".
 */
export function OnboardingInterestsStep({
  initialNodeIds,
  returnTo,
}: OnboardingInterestsStepProps) {
  const t = useTranslations("onboarding.interests");
  const router = useRouter();
  const [selected, setSelected] = useState<readonly string[]>(initialNodeIds);
  const { status, run } = useMeActionStatus();

  useEffect(() => {
    recordOnboardingMark("interests-start");
  }, []);

  function toggle(id: string) {
    const next = selected.includes(id)
      ? selected.filter((existing) => existing !== id)
      : [...selected, id];
    setSelected(next);
    run(
      () => updateInterestsAction(next),
      (data) => setSelected(data.nodeIds),
    );
  }

  function handleContinue() {
    recordOnboardingMark("interests-complete");
    measureOnboardingDuration("yourtal:interests", "interests-start", "interests-complete");
    router.push(withReturnTo("/onboarding/follow", returnTo) as Route);
  }

  return (
    <Section title={t("heading")} description={t("intro")}>
      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-3"
        role="group"
        aria-label={t("heading")}
      >
        {ME_INTEREST_CATEGORIES.map((category) => {
          const isSelected = selected.includes(category.id);
          const Icon = category.icon;
          const label = t.has(`categories.${category.id}`)
            ? t(`categories.${category.id}`)
            : category.fallbackLabel;
          return (
            <ChoiceCard
              key={category.id}
              type="checkbox"
              name="interest"
              value={category.id}
              checked={isSelected}
              onChange={() => toggle(category.id)}
              title={label}
              media={<Icon aria-hidden="true" className="h-6 w-6" />}
            />
          );
        })}
      </div>
      <Text size="body-sm" tone="muted" role="status" aria-live="polite">
        {selected.length} {t("selectedSuffix")}
      </Text>
      {status.kind === "error" ? (
        <Text size="body-sm" tone="danger" role="alert">
          {status.message}
        </Text>
      ) : null}
      <Button type="button" onClick={handleContinue}>
        {selected.length > 0 ? t("continueCta") : t("skipCta")}
      </Button>
    </Section>
  );
}
