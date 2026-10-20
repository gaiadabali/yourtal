"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import {
  MAX_TARGET_DISTRICTS,
  cleanTargetDistricts,
} from "@yourtal/contracts/campaign/target-districts";
import { fetchAreaSummariesAction } from "@/features/areas/area-actions";
import { AreaPicker } from "@/features/areas/area-picker";
import { areaSummaryLabel } from "@/features/areas/area-label";
import type { CampaignTargeting } from "./campaign-draft";
import { TagPicker } from "../tag-picker";

export interface CampaignEditorTargetingProps {
  targeting: CampaignTargeting;
  onChange: (targeting: CampaignTargeting) => void;
  disabled?: boolean;
}

/**
 * Targeting: interest tags from the taxonomy (13.11.a) and districts (docs/17 §2's Campaigns
 * zone: "targeting"). Untargeted (empty) is a valid, honest choice, shown as "targets everyone",
 * not left ambiguous. F116: a district is a postcode, picked by state and suburb from the fixed
 * area list (never typed), and the feed shows a targeted campaign only to viewers who declared
 * one of them as "my area" in Me.
 */
export function CampaignEditorTargeting({
  targeting,
  onChange,
  disabled,
}: CampaignEditorTargetingProps) {
  const t = useTranslations("studio");
  const full = targeting.districts.length >= MAX_TARGET_DISTRICTS;
  return (
    <div className="flex flex-col gap-4">
      {/* 13.11.a: tags come from the interest taxonomy and are saved as the campaign's tags. */}
      <TagPicker
        value={targeting.interests}
        disabled={disabled}
        onChange={(interests) => onChange({ ...targeting, interests })}
      />
      <fieldset className="flex flex-col gap-3">
        <legend className="text-label font-sans text-fg">
          {t("campaignBuilder.targeting.districtsLabel")}
        </legend>
        <p className="text-xs font-sans text-fg-muted">
          {t("campaignBuilder.targeting.districtsHint", { max: MAX_TARGET_DISTRICTS })}
        </p>
        <DistrictChips
          postcodes={targeting.districts}
          disabled={disabled === true}
          onRemove={(postcode) =>
            onChange({
              ...targeting,
              districts: targeting.districts.filter((item) => item !== postcode),
            })
          }
        />
        {full ? (
          <p className="text-xs font-sans text-fg-muted">
            {t("campaignBuilder.targeting.districtsFull", { max: MAX_TARGET_DISTRICTS })}
          </p>
        ) : null}
        <AreaPicker
          chosen={targeting.districts}
          disabled={disabled === true || full}
          onPick={(place) =>
            onChange({
              ...targeting,
              districts: cleanTargetDistricts([...targeting.districts, place.postcode]).slice(
                0,
                MAX_TARGET_DISTRICTS,
              ),
            })
          }
        />
      </fieldset>
    </div>
  );
}

interface DistrictChipsProps {
  postcodes: string[];
  onRemove: (postcode: string) => void;
  disabled: boolean;
}

/** The chosen postcodes, each with the suburbs it covers so a business reads places, not digits. */
function DistrictChips({ postcodes, onRemove, disabled }: DistrictChipsProps) {
  const t = useTranslations("studio");
  const tAreas = useTranslations("areas");
  const [labels, setLabels] = useState<Record<string, string>>({});
  const missingKey = postcodes.filter((postcode) => labels[postcode] === undefined).join(",");

  useEffect(() => {
    if (missingKey.length === 0) return;
    let live = true;
    void fetchAreaSummariesAction(missingKey.split(",")).then((result) => {
      if (!live || !result.ok) return;
      setLabels((previous) => ({
        ...previous,
        ...Object.fromEntries(
          result.data.areas.map((area) => [
            area.postcode,
            areaSummaryLabel(area, (count) => tAreas("andMore", { count })),
          ]),
        ),
      }));
    });
    return () => {
      live = false;
    };
  }, [missingKey, tAreas]);

  if (postcodes.length === 0) {
    return (
      <p className="text-xs font-sans text-fg-muted">
        {t("campaignBuilder.targeting.noDistricts")}
      </p>
    );
  }
  return (
    <ul
      className="flex flex-wrap gap-1.5"
      aria-label={t("campaignBuilder.targeting.districtsLabel")}
    >
      {postcodes.map((postcode) => {
        const value =
          labels[postcode] === undefined ? postcode : `${postcode} · ${labels[postcode]}`;
        return (
          <li key={postcode}>
            <Badge variant="secondary" className="gap-1.5">
              {value}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onRemove(postcode)}
                disabled={disabled}
                aria-label={t("campaignBuilder.targeting.removeTag", { value })}
                className="size-4 text-fg-subtle hover:text-fg"
              >
                ×
              </Button>
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}
