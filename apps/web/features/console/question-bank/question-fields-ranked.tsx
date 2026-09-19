"use client";

import { Button } from "@yourtal/ui/button";
import { Input } from "@yourtal/ui/input";
import type { RankedQuestionDraft } from "./question-draft";

export interface RankedFieldsProps {
  draft: RankedQuestionDraft;
  onChange: (draft: RankedQuestionDraft) => void;
}

const MIN_ITEMS = 2;
const MAX_ITEMS = 6;

/**
 * The ranked-specific authoring fields: the item list a viewer will
 * reorder. There is no "correct order" to mark here (docs/06 §4.1: ranked
 * questions are opinion, never scored) — the author is only naming the
 * items themselves; the viewer-facing view (`ranked-question.tsx`) shuffles
 * their presentation order per respondent.
 */
export function RankedFields({ draft, onChange }: RankedFieldsProps) {
  function updateItem(itemId: string, label: string) {
    onChange({
      ...draft,
      items: draft.items.map((item) => (item.id === itemId ? { ...item, label } : item)),
    });
  }

  function addItem() {
    if (draft.items.length >= MAX_ITEMS) {
      return;
    }
    onChange({ ...draft, items: [...draft.items, { id: crypto.randomUUID(), label: "" }] });
  }

  function removeItem(itemId: string) {
    if (draft.items.length <= MIN_ITEMS) {
      return;
    }
    onChange({ ...draft, items: draft.items.filter((item) => item.id !== itemId) });
  }

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-sans font-medium text-fg">Items to rank</legend>
      {draft.items.map((item, index) => (
        <div key={item.id} className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              label={`Item ${index + 1}`}
              hideLabel
              placeholder={`Item ${index + 1}`}
              value={item.label}
              onChange={(event) => updateItem(item.id, event.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => removeItem(item.id)}
            disabled={draft.items.length <= MIN_ITEMS}
            aria-label={`Remove item ${index + 1}`}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={addItem}
        disabled={draft.items.length >= MAX_ITEMS}
      >
        Add item
      </Button>
    </fieldset>
  );
}
