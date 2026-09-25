"use client";

import * as React from "react";
import { SegmentedControl } from "@yourtal/ui/segmented-control";
import { ActionsGroup } from "./groups/actions";
import { BrandGroup } from "./groups/brand";
import { DataDisplayGroup } from "./groups/data-display";
import { FeedbackGroup } from "./groups/feedback";
import { FormsGroup } from "./groups/forms";
import { OverlaysGroup } from "./groups/overlays";
import { LayoutGroup } from "./groups/structure";
import { RewardsMediaGroup } from "./groups/rewards-media";
import { ShellsGroup } from "./groups/shells";
import { VideoGroup } from "./groups/video";

const SURFACES = [
  { value: "viewer", label: "Viewer" },
  { value: "studio", label: "Studio" },
  { value: "counter", label: "Counter" },
] as const;

const THEMES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

export type GallerySurface = (typeof SURFACES)[number]["value"];
export type GalleryTheme = (typeof THEMES)[number]["value"];

export interface GalleryProps {
  initialSurface: GallerySurface;
  initialTheme: GalleryTheme;
}

/**
 * Every `@yourtal/ui` export on one page, for visual review and the visual
 * test baselines. `data-surface`/`data-theme` on the root let the header
 * controls (and a `?surface=`/`?theme=` URL, read once by the server page)
 * drive the same tokens the real app uses — nothing here is bespoke CSS.
 */
export function Gallery({ initialSurface, initialTheme }: GalleryProps) {
  const [surface, setSurface] = React.useState<GallerySurface>(initialSurface);
  const [theme, setTheme] = React.useState<GalleryTheme>(initialTheme);

  return (
    <div data-surface={surface} data-theme={theme} className="min-h-dvh bg-canvas text-fg">
      <header
        data-gallery-chrome
        className="sticky top-0 z-(--z-nav) flex flex-wrap items-center justify-between gap-4 border-b border-border-subtle bg-surface px-gutter-md py-3"
      >
        <div>
          <p className="text-title font-sans font-semibold text-fg">YourTal primitives</p>
          <p className="text-caption text-fg-muted">Every @yourtal/ui export, one page.</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <SegmentedControl
            label="Surface"
            options={SURFACES}
            value={surface}
            onChange={setSurface}
          />
          <SegmentedControl label="Theme" options={THEMES} value={theme} onChange={setTheme} />
        </div>
      </header>
      <main className="mx-auto flex max-w-page-wide flex-col gap-8 px-gutter-sm py-8 md:px-gutter-md lg:px-gutter-lg">
        <BrandGroup />
        <ActionsGroup />
        <FormsGroup />
        <OverlaysGroup />
        <FeedbackGroup />
        <LayoutGroup />
        <DataDisplayGroup />
        <RewardsMediaGroup />
        <VideoGroup />
        <ShellsGroup />
      </main>
    </div>
  );
}
