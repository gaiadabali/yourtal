"use client";

import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@yourtal/ui/sheet";
import { Button } from "@yourtal/ui/button";
import {
  buildQualityOptions,
  estimateDataCostMb,
  getQualityTier,
  type QualityTierId,
} from "./quality-tier";
import { getPlayerTranslator, type SupportedLocale } from "./player-i18n";

export interface QualitySelectorProps {
  durationSeconds: number;
  selectedTierId: QualityTierId;
  onSelect: (id: QualityTierId) => void;
  locale: SupportedLocale;
}

/**
 * The data-cost-honesty screen (docs/06-longform-video-and-attention.md
 * §2.3 rule 2: "Show the data cost before playback... a trust feature in
 * Indonesia, not a nicety"). Every option's MB figure is computed from that
 * tier's own bitrate and THIS campaign's own duration
 * (`buildQualityOptions`) — never a flat, hardcoded number.
 */
export function QualitySelector({
  durationSeconds,
  selectedTierId,
  onSelect,
  locale,
}: QualitySelectorProps) {
  const t = getPlayerTranslator(locale);
  const options = buildQualityOptions(durationSeconds);
  const selectedTier = getQualityTier(selectedTierId);
  const selectedMb = estimateDataCostMb(selectedTier.targetBitrateKbps, durationSeconds);

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" variant="secondary" size="sm">
          {t("quality.triggerSummary", {
            label: selectedTier.label,
            mb: Math.round(selectedMb),
          })}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>{t("quality.sheetTitle")}</SheetTitle>
          <SheetDescription>{t("quality.description")}</SheetDescription>
        </SheetHeader>
        <RadioGroupPrimitive.Root
          value={selectedTierId}
          // Radix's onValueChange is typed as plain `string`, but every
          // <RadioGroupPrimitive.Item value=...> below is drawn from
          // `options`, whose ids are all `QualityTierId` — the cast can
          // only ever see one of those three literals back.
          onValueChange={(value) => onSelect(value as QualityTierId)}
          className="flex flex-col gap-2"
          aria-label={t("quality.ariaLabel")}
        >
          {options.map((option) => (
            <label
              key={option.id}
              htmlFor={`quality-tier-${option.id}`}
              className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border p-3 has-[[data-state=checked]]:border-primary"
            >
              <span className="flex flex-col">
                <span className="text-sm font-sans font-medium text-fg">{option.label}</span>
                <span className="text-xs font-sans text-fg-muted">
                  {t("quality.estimatedMb", { mb: Math.round(option.estimatedMb) })}
                </span>
              </span>
              <RadioGroupPrimitive.Item
                id={`quality-tier-${option.id}`}
                value={option.id}
                className="h-5 w-5 shrink-0 rounded-full border border-border-strong data-[state=checked]:border-primary"
              >
                <RadioGroupPrimitive.Indicator className="flex h-full w-full items-center justify-center after:h-2.5 after:w-2.5 after:rounded-full after:bg-primary" />
              </RadioGroupPrimitive.Item>
            </label>
          ))}
        </RadioGroupPrimitive.Root>
      </SheetContent>
    </Sheet>
  );
}
