"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("studio");
  return (
    <div className="flex flex-col gap-4">
      <TagList
        label={t("campaignBuilder.targeting.interestsLabel")}
        emptyMessage={t("campaignBuilder.targeting.noInterests")}
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
        label={t("campaignBuilder.targeting.districtsLabel")}
        emptyMessage={t("campaignBuilder.targeting.noDistricts")}
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
  emptyMessage: string;
  values: string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
  disabled?: boolean | undefined;
}

/** Local subcomponent, never reused outside this file's two calls above. */
function TagList({ label, emptyMessage, values, onAdd, onRemove, disabled }: TagListProps) {
  const t = useTranslations("studio");
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
            placeholder={t("campaignBuilder.targeting.tagPlaceholder")}
          />
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={commit} disabled={disabled}>
          {t("campaignBuilder.targeting.add")}
        </Button>
      </div>
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <Badge key={value} variant="secondary" className="gap-1.5">
              {value}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onRemove(value)}
                disabled={disabled}
                aria-label={t("campaignBuilder.targeting.removeTag", { value })}
                className="size-4 text-fg-subtle hover:text-fg"
              >
                ×
              </Button>
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-xs font-sans text-fg-muted">{emptyMessage}</p>
      )}
    </div>
  );
}
