"use client";

import { useRef } from "react";
import type { KeyboardEvent } from "react";
import { cn } from "@yourtal/ui/cn";
import type { CampaignEditorSection } from "./campaign-editor-sections";
import {
  CAMPAIGN_EDITOR_SECTIONS,
  CAMPAIGN_EDITOR_SECTION_LABELS,
} from "./campaign-editor-sections";

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
  const buttonRefs = useRef(new Map<CampaignEditorSection, HTMLButtonElement>());

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
      aria-label="Campaign editor sections"
      className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface-raised p-1"
    >
      {CAMPAIGN_EDITOR_SECTIONS.map((section, index) => {
        const isActive = section === active;
        return (
          <button
            key={section}
            type="button"
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
              "inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-sans font-medium text-fg-muted transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive && "bg-surface text-fg shadow-sm",
            )}
          >
            {CAMPAIGN_EDITOR_SECTION_LABELS[section]}
          </button>
        );
      })}
    </div>
  );
}
