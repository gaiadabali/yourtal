"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Section } from "@yourtal/ui/section";
import { ChoiceCard } from "@yourtal/ui/choice-card";
import { Text } from "@yourtal/ui/text";
import { ME_INTEREST_CATEGORIES, ME_TEEN_INTEREST_CATEGORIES } from "./me-interest-catalogue";
import { updateInterestsAction } from "./me-actions";
import { useMeActionStatus } from "./use-me-action-status";

export interface MeInterestsSectionProps {
  initialNodeIds: readonly string[];
  /** 12.2.a: a teen sees only `ME_TEEN_INTEREST_CATEGORIES`, never the adult roots. */
  ageBand: "teen" | "adult";
}

/**
 * `PUT /api/me/interests` (5.4.a), saved on every toggle — matches
 * `interests.controller.ts`'s own "replaces one set with another; retrying
 * the same body ends in the same state" idempotency, so a rapid double
 * click never corrupts the set (later write always wins, never merges).
 * Categories come from the real taxonomy (`me-interest-catalogue.ts`), not
 * a hand-duplicated list, so nothing offered here can ever be rejected by
 * `isKnownInterestNode` — and, for a teen, `interests.controller.ts`'s `PUT`
 * refuses anything outside `ME_TEEN_INTEREST_CATEGORIES` regardless of what
 * this UI offers.
 */
export function MeInterestsSection({ initialNodeIds, ageBand }: MeInterestsSectionProps) {
  const t = useTranslations("me.interests");
  const categories = ageBand === "teen" ? ME_TEEN_INTEREST_CATEGORIES : ME_INTEREST_CATEGORIES;
  const [selected, setSelected] = useState<readonly string[]>(initialNodeIds);
  const { status, run } = useMeActionStatus();

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

  return (
    <Section title={t("heading")} description={t("intro")}>
      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
        role="group"
        aria-label={t("heading")}
      >
        {categories.map((category) => {
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
    </Section>
  );
}
