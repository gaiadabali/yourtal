"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { cn } from "@yourtal/ui/cn";
import { ME_INTEREST_OPTIONS } from "./me-interest-option";
import { getMeTranslator, type SupportedLocale } from "./me-i18n";

export interface MeInterestsSectionProps {
  locale: SupportedLocale;
  selectedIds: readonly string[];
  onToggle: (id: string) => void;
}

/**
 * The interests editor (YT-0433: "interests connect to the onboarding
 * picker — same vocabulary, and changes must be reversible"). Same
 * toggle-button-group pattern as `features/onboarding/interest-picker.tsx`
 * (`aria-pressed`, fully keyboard-operable via Tab/Enter/Space), and the
 * exact same catalogue (`me-interest-option.ts`, lockstep-tested against
 * onboarding's). Every tile stays clickable in both directions — selecting
 * and deselecting are the same one-click gesture, nothing is ever locked in.
 */
export function MeInterestsSection({ locale, selectedIds, onToggle }: MeInterestsSectionProps) {
  const t = getMeTranslator(locale);

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("interests.heading")}</CardTitle>
        <p className="text-sm font-sans text-fg-muted">{t("interests.intro")}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div
          className="grid grid-cols-3 gap-2 sm:grid-cols-4"
          role="group"
          aria-label={t("interests.heading")}
        >
          {ME_INTEREST_OPTIONS.map((option) => {
            const isSelected = selectedIds.includes(option.id);
            const Icon = option.icon;
            const label = locale === "id-ID" ? option.labelId : option.labelEn;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => onToggle(option.id)}
                className={cn(
                  "flex aspect-square flex-col items-center justify-center gap-1.5 rounded-lg border p-2 text-center transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isSelected
                    ? "border-primary ring-2 ring-ring"
                    : "border-border hover:border-border-strong",
                )}
              >
                <span
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full",
                    TINT_CLASSES[option.tint],
                  )}
                >
                  <Icon aria-hidden="true" className="h-4 w-4" />
                </span>
                <span className="text-xs font-sans font-medium leading-tight text-fg">{label}</span>
              </button>
            );
          })}
        </div>
        <p className="text-xs font-sans text-fg-muted" aria-live="polite">
          {selectedIds.length} {t("interests.selectedSuffix")} · {t("interests.savedHint")}
        </p>
      </CardContent>
    </Card>
  );
}

/** Full literal class strings — Tailwind's build-time scanner needs them verbatim in source. See `interest-picker.tsx`'s identical comment. */
const TINT_CLASSES: Record<(typeof ME_INTEREST_OPTIONS)[number]["tint"], string> = {
  primary: "bg-primary/10 text-primary",
  reward: "bg-reward/10 text-reward",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  price: "bg-price/10 text-price",
};
