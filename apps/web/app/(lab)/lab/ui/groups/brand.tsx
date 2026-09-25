"use client";

import * as React from "react";
import { BrandMark, BrandWordmark } from "@yourtal/ui/brand/wordmark";
import { GalleryRow, GallerySection } from "../lib/gallery-section";

const WORDMARK_SIZES = ["sm", "md", "lg", "xl"] as const;

/** App icon files, and the manifest icon they back — reviewed here as real <img>s, not descriptions. */
const APP_ICONS = [
  { src: "/icon.svg", label: "icon.svg (favicon, any browser tab)" },
  { src: "/apple-icon.png", label: "apple-icon.png, 180px" },
  { src: "/icons/icon-192.png", label: "icons/icon-192.png" },
  { src: "/icons/icon-512.png", label: "icons/icon-512.png" },
  { src: "/icons/icon-512-maskable.png", label: "icons/icon-512-maskable.png (Android safe zone)" },
] as const;

/**
 * The brand mark and wordmark (task 3.6.a): every size the shared
 * `@yourtal/ui/brand/wordmark` component ships, the coin mark alone, and
 * the static app icon files it was rasterised into — so a regression in
 * any of them (a missing file, a size that renders blank) is visible on
 * this one page rather than only discoverable at `/favicon.ico`.
 */
export function BrandGroup() {
  return (
    <GallerySection
      id="brand"
      title="Brand"
      description="The YourTal wordmark, the coin mark alone, and the generated app icon files."
    >
      <GalleryRow label="Wordmark, every size">
        {WORDMARK_SIZES.map((size) => (
          <BrandWordmark key={size} size={size} />
        ))}
      </GalleryRow>

      <GalleryRow label="Mark alone">
        {WORDMARK_SIZES.map((size) => (
          <BrandMark key={size} size={size} />
        ))}
      </GalleryRow>

      <GalleryRow label="App icons">
        {APP_ICONS.map(({ src, label }) => (
          <figure key={src} className="flex flex-col items-center gap-1.5">
            <div className="flex h-16 w-16 items-center justify-center rounded-control bg-surface-sunken">
              {/* Real static files served from the app, not copies — a broken
                  path here means the actual route 404s. */}
              <img src={src} alt="" className="max-h-14 max-w-14" />
            </div>
            <figcaption className="text-caption text-fg-subtle">{label}</figcaption>
          </figure>
        ))}
      </GalleryRow>
    </GallerySection>
  );
}
