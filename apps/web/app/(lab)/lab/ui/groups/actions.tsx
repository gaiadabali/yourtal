"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Badge } from "@yourtal/ui/badge";
import { Button } from "@yourtal/ui/button";
import { Chip } from "@yourtal/ui/chip";
import { SegmentedControl } from "@yourtal/ui/segmented-control";
import { StatusBadge } from "@yourtal/ui/status-badge";
import { Switch } from "@yourtal/ui/switch";
import { GalleryRow, GallerySection } from "../lib/gallery-section";

const BUTTON_VARIANTS = ["primary", "secondary", "ghost", "danger", "link"] as const;
const BUTTON_V1_ALIASES = ["default", "destructive", "outline"] as const;
const BUTTON_SIZES = ["sm", "md", "lg", "counter"] as const;
const BADGE_VARIANTS = [
  "default",
  "secondary",
  "success",
  "warning",
  "danger",
  "reward",
  "outline",
] as const;
const STATUSES = ["success", "warning", "danger", "info", "neutral"] as const;
const EMPHASES = ["subtle", "solid"] as const;
const RANGE_OPTIONS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
] as const;

/** Buttons, badges, chips, the segmented control and the switch — every action/status primitive. */
export function ActionsGroup() {
  const [range, setRange] = React.useState<"day" | "week" | "month">("week");
  const [chipPressed, setChipPressed] = React.useState<Record<string, boolean>>({
    video: true,
    audio: false,
  });

  return (
    <>
      <GallerySection id="buttons" title="Button" description="Every variant, size and state.">
        <GalleryRow label="Variants">
          {BUTTON_VARIANTS.map((variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          ))}
        </GalleryRow>
        <GalleryRow label="v1 aliases (default / destructive / outline)">
          {BUTTON_V1_ALIASES.map((variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          ))}
        </GalleryRow>
        <GalleryRow label="Sizes">
          {BUTTON_SIZES.map((size) => (
            <Button key={size} size={size}>
              {size}
            </Button>
          ))}
          <Button size="icon" aria-label="Add reward">
            <Plus className="size-4" aria-hidden="true" />
          </Button>
        </GalleryRow>
        <GalleryRow label="States">
          {/* packages/ui bug (reported, not patched here): Button's `loading` state hides its
              label with the `invisible` utility, which drops it from the accessible name too —
              an aria-label matching the label is the only way a loading button keeps one. */}
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
          <Button leadingIcon={<Plus className="size-4" aria-hidden="true" />}>With icon</Button>
        </GalleryRow>
      </GallerySection>

      <GallerySection id="badges" title="Badge and StatusBadge" description="Every tone.">
        <GalleryRow label="Badge">
          {BADGE_VARIANTS.map((variant) => (
            <Badge key={variant} variant={variant}>
              {variant}
            </Badge>
          ))}
        </GalleryRow>
        {EMPHASES.map((emphasis) => (
          <GalleryRow key={emphasis} label={`StatusBadge — ${emphasis}`}>
            {STATUSES.map((status) => (
              <StatusBadge key={status} status={status} emphasis={emphasis}>
                {status}
              </StatusBadge>
            ))}
          </GalleryRow>
        ))}
      </GallerySection>

      <GallerySection
        id="chips"
        title="Chip and SegmentedControl"
        description="A selectable filter chip, a static tag, and a one-of-many segmented control."
      >
        <GalleryRow label="Filter chips">
          <Chip
            pressed={chipPressed.video ?? false}
            onPressedChange={(pressed) => {
              setChipPressed((prev) => ({ ...prev, video: pressed }));
            }}
          >
            Video
          </Chip>
          <Chip
            pressed={chipPressed.audio ?? false}
            onPressedChange={(pressed) => {
              setChipPressed((prev) => ({ ...prev, audio: pressed }));
            }}
          >
            Audio
          </Chip>
          <Chip pressed disabled onPressedChange={() => undefined}>
            Disabled
          </Chip>
          <Chip variant="static">Sponsored</Chip>
        </GalleryRow>
        <GalleryRow label="SegmentedControl">
          <SegmentedControl
            label="Time range"
            options={RANGE_OPTIONS}
            value={range}
            onChange={setRange}
          />
        </GalleryRow>
      </GallerySection>

      <GallerySection id="switches" title="Switch" description="On, off and disabled.">
        <GalleryRow label="States">
          <Switch label="Autoplay next video" defaultChecked />
          <Switch label="Data saver" defaultChecked={false} />
          <Switch label="Locked setting" disabled defaultChecked />
        </GalleryRow>
      </GallerySection>
    </>
  );
}
