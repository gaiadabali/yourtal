"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Region } from "@yourtal/contracts/region";
import { Button } from "@yourtal/ui/button";
import { regionDisplayConfig } from "@/features/region/region-config";
import { getOnboardingCopy } from "./onboarding-copy";
import { INTEREST_OPTIONS } from "./interest-option";
import type { InterestOption } from "./interest-option";
import { saveOnboardingInterestSelection } from "./onboarding-local-store";
import { measureOnboardingDuration, recordOnboardingMark } from "./onboarding-timing";

export interface InterestPickerProps {
  region: Region;
}

/**
 * Full literal class strings, not a computed `bg-${tint}/10` template —
 * Tailwind's build-time scanner needs the complete class name to appear
 * verbatim in source to keep it in the compiled CSS.
 */
const TINT_CLASSES: Record<InterestOption["tint"], string> = {
  primary: "bg-primary/10 text-primary",
  reward: "bg-reward/10 text-reward",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  price: "bg-price/10 text-price",
};

/**
 * Multi-select interest grid (docs/tasks/phase-u-ui.md YT-0430: "Interest
 * picker with images... 15 seconds to complete"). No image asset pipeline
 * exists in this ticket's scope, so each tile is an honest CSS/SVG
 * placeholder — a fixed `aspect-square` tile with a centred Lucide icon on
 * a tinted token background — rather than a grey box standing in for a
 * photo that does not exist. Zero network requests, zero layout shift.
 *
 * Selection is a toggle-button group (`aria-pressed`, not checkboxes: this
 * is app state carried via `router.push`, not form data), so it is fully
 * keyboard operable via Tab/Enter/Space with no extra wiring.
 */
export function InterestPicker({ region }: InterestPickerProps) {
  const router = useRouter();
  const { locale } = regionDisplayConfig(region);
  const copy = getOnboardingCopy(locale).interests;
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    recordOnboardingMark("interests-start");
  }, []);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleContinue() {
    recordOnboardingMark("interests-complete");
    measureOnboardingDuration("yourtal:interests", "interests-start", "interests-complete");
    saveOnboardingInterestSelection([...selected]);
    router.push(`/onboarding/${region}/done`);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-sans font-semibold text-fg">{copy.heading}</h2>
        <p className="text-sm font-sans text-fg-muted">{copy.intro}</p>
      </div>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label={copy.heading}>
        {INTEREST_OPTIONS.map((option) => {
          const isSelected = selected.has(option.id);
          const Icon = option.icon;
          const label = locale === "id-ID" ? option.labelId : option.labelEn;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => toggle(option.id)}
              className={`flex aspect-square flex-col items-center justify-center gap-1.5 rounded-lg border p-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                isSelected
                  ? "border-primary ring-2 ring-ring"
                  : "border-border hover:border-border-strong"
              }`}
            >
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-full ${TINT_CLASSES[option.tint]}`}
              >
                <Icon aria-hidden="true" className="h-5 w-5" />
              </span>
              <span className="text-xs font-sans font-medium leading-tight text-fg">{label}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs font-sans text-fg-muted" aria-live="polite">
        {selected.size} {copy.selectedSuffix}
      </p>
      <Button type="button" onClick={handleContinue}>
        {selected.size > 0 ? copy.continueLabel : copy.skipLabel}
      </Button>
    </div>
  );
}
