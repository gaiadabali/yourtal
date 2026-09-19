"use client";

import { Input } from "@yourtal/ui/input";
import type { LikertQuestionDraft } from "./question-draft";

export interface LikertFieldsProps {
  draft: LikertQuestionDraft;
  onChange: (draft: LikertQuestionDraft) => void;
}

/**
 * The likert-specific authoring fields: the scale's two endpoint labels.
 * `scaleMin`/`scaleMax` are fixed at 1-5 by `createEmptyQuestionDraft` —
 * this ticket's brief does not ask for a configurable scale width, and a
 * fixed width keeps every campaign's Likert data comparable in reporting
 * (docs/06 §4.4).
 */
export function LikertFields({ draft, onChange }: LikertFieldsProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <div className="flex-1">
        <Input
          label={`Low end (${draft.scaleMin})`}
          placeholder="e.g. Not at all likely"
          value={draft.scaleLowLabel}
          onChange={(event) => onChange({ ...draft, scaleLowLabel: event.target.value })}
        />
      </div>
      <div className="flex-1">
        <Input
          label={`High end (${draft.scaleMax})`}
          placeholder="e.g. Extremely likely"
          value={draft.scaleHighLabel}
          onChange={(event) => onChange({ ...draft, scaleHighLabel: event.target.value })}
        />
      </div>
    </div>
  );
}
