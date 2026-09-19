"use client";

import { useState } from "react";
import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import { Input } from "@yourtal/ui/input";
import type { CampaignTargeting } from "./campaign-draft";

export interface CampaignEditorTargetingProps {
  targeting: CampaignTargeting;
  onChange: (targeting: CampaignTargeting) => void;
  disabled?: boolean;
}

/** Targeting: interests and districts, both free-form tag lists (docs/17 §2's Campaigns zone: "targeting"). Untargeted (empty) is a valid, honest choice — shown as "targets everyone", not left ambiguous. */
export function CampaignEditorTargeting({
  targeting,
  onChange,
  disabled,
}: CampaignEditorTargetingProps) {
  return (
    <div className="flex flex-col gap-4">
      <TagList
        label="Interests"
        values={targeting.interests}
        disabled={disabled}
        onAdd={(value) => onChange({ ...targeting, interests: [...targeting.interests, value] })}
        onRemove={(value) =>
          onChange({
            ...targeting,
            interests: targeting.interests.filter((item) => item !== value),
          })
        }
      />
      <TagList
        label="Districts"
        values={targeting.districts}
        disabled={disabled}
        onAdd={(value) => onChange({ ...targeting, districts: [...targeting.districts, value] })}
        onRemove={(value) =>
          onChange({
            ...targeting,
            districts: targeting.districts.filter((item) => item !== value),
          })
        }
      />
    </div>
  );
}

interface TagListProps {
  label: string;
  values: string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
  disabled?: boolean | undefined;
}

/** Local subcomponent, never reused outside this file's two calls above. */
function TagList({ label, values, onAdd, onRemove, disabled }: TagListProps) {
  const [draft, setDraft] = useState("");

  function commit() {
    const trimmed = draft.trim();
    if (trimmed.length > 0 && !values.includes(trimmed)) {
      onAdd(trimmed);
    }
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            label={label}
            value={draft}
            disabled={disabled}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              }
            }}
            placeholder="Type and press Enter"
          />
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={commit} disabled={disabled}>
          Add
        </Button>
      </div>
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <Badge key={value} variant="secondary" className="gap-1.5">
              {value}
              <button
                type="button"
                onClick={() => onRemove(value)}
                disabled={disabled}
                aria-label={`Remove ${value}`}
                className="text-fg-subtle hover:text-fg"
              >
                ×
              </button>
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-xs font-sans text-fg-muted">
          No {label.toLowerCase()} added — this campaign targets everyone.
        </p>
      )}
    </div>
  );
}
