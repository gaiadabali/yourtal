"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import { Input } from "@yourtal/ui/input";
import type { CampaignTargeting } from "./campaign-draft";
import {
  MAX_DISTRICT_LENGTH,
  MAX_TARGET_DISTRICTS,
  cleanTargetDistricts,
  districtKey,
  normaliseDistrict,
} from "@yourtal/contracts/campaign/target-districts";
import { TagPicker } from "../tag-picker";

export interface CampaignEditorTargetingProps {
  targeting: CampaignTargeting;
  onChange: (targeting: CampaignTargeting) => void;
  disabled?: boolean;
}

/**
 * Targeting: interest tags from the taxonomy (13.11.a) and free-form districts (docs/17 §2's
 * Campaigns zone: "targeting"). Untargeted (empty) is a valid, honest choice — shown as "targets
 * everyone", not left ambiguous. 14.2: districts save with the details and the feed shows a
 * targeted campaign only in them; spelling and case are normalised the way the server does.
 */
export function CampaignEditorTargeting({
  targeting,
  onChange,
  disabled,
}: CampaignEditorTargetingProps) {
  const t = useTranslations("studio");
  return (
    <div className="flex flex-col gap-4">
      {/* 13.11.a: tags come from the interest taxonomy and are saved as the campaign's tags. */}
      <TagPicker
        value={targeting.interests}
        disabled={disabled}
        onChange={(interests) => onChange({ ...targeting, interests })}
      />
      <p className="text-xs font-sans text-fg-muted">
        {t("campaignBuilder.targeting.districtsHint", { max: MAX_TARGET_DISTRICTS })}
      </p>
      <TagList
        label={t("campaignBuilder.targeting.districtsLabel")}
        emptyMessage={t("campaignBuilder.targeting.noDistricts")}
        values={targeting.districts}
        disabled={disabled === true || targeting.districts.length >= MAX_TARGET_DISTRICTS}
        onAdd={(value) =>
          onChange({
            ...targeting,
            districts: cleanTargetDistricts([...targeting.districts, value]).slice(
              0,
              MAX_TARGET_DISTRICTS,
            ),
          })
        }
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
    const name = normaliseDistrict(draft);
    if (name.length > 0 && !values.some((value) => districtKey(value) === districtKey(name))) {
      onAdd(name);
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
            maxLength={MAX_DISTRICT_LENGTH}
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
