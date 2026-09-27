"use client";

import { useRef } from "react";
import type { KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import { cn } from "@yourtal/ui/cn";
import type { CampaignEditorSection } from "./campaign-editor-sections";
import { CAMPAIGN_EDITOR_SECTIONS } from "./campaign-editor-sections";

export interface CampaignEditorSectionNavProps {
  active: CampaignEditorSection;
  onChange: (section: CampaignEditorSection) => void;
}

/**
 * A small, hand-built ARIA tabs pattern (`role="tablist"`/`"tab"`, roving
 * tabindex, arrow-key navigation) rather than `@yourtal/ui/tabs`
 * (`@radix-ui/react-tabs`) — that primitive alone cost ~8.5 KB gz measured
 * in this route's own production chunk, on a route that was ~13 KB over
 * the 200 KB hard gate (see this ticket's report). The same reasoning
 * `radio-question-group.tsx` used for a missing radio-group primitive
 * applies here: build the small amount of real accessibility work locally
 * rather than pay for a general-purpose primitive this one screen does not
 * need the rest of.
 */
export function CampaignEditorSectionNav({ active, onChange }: CampaignEditorSectionNavProps) {
  const t = useTranslations("studio");
  const buttonRefs = useRef(new Map<CampaignEditorSection, HTMLButtonElement>());
  const sectionLabels: Record<CampaignEditorSection, string> = {
    details: t("campaignBuilder.sections.details"),
    video: t("campaignBuilder.sections.video"),
    reward: t("campaignBuilder.sections.reward"),
    targeting: t("campaignBuilder.sections.targeting"),
    budget: t("campaignBuilder.sections.budget"),
    questions: t("campaignBuilder.sections.questions"),
  };

  function focusAndSelect(section: CampaignEditorSection) {
    onChange(section);
    buttonRefs.current.get(section)?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
      return;
    }
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex =
      (index + delta + CAMPAIGN_EDITOR_SECTIONS.length) % CAMPAIGN_EDITOR_SECTIONS.length;
    const next = CAMPAIGN_EDITOR_SECTIONS[nextIndex];
    if (next) {
      focusAndSelect(next);
    }
  }

  return (
    <div
      role="tablist"
      aria-label={t("campaignBuilder.sections.navLabel")}
      className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface-raised p-1"
    >
      {CAMPAIGN_EDITOR_SECTIONS.map((section, index) => {
        const isActive = section === active;
        return (
          <Button
            key={section}
            type="button"
            variant="ghost"
            size="sm"
            role="tab"
            id={`campaign-editor-tab-${section}`}
            aria-selected={isActive}
            aria-controls={`campaign-editor-panel-${section}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(section)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            ref={(element) => {
              if (element) {
                buttonRefs.current.set(section, element);
              }
            }}
            className={cn(
              "h-8 px-3 font-medium text-fg-muted",
              isActive && "bg-surface text-fg shadow-sm",
            )}
          >
            {sectionLabels[section]}
          </Button>
        );
      })}
    </div>
  );
}
