"use client";

import * as React from "react";
import { CounterShell } from "@yourtal/ui/counter-shell";
import { StudioShell } from "@yourtal/ui/studio-shell";
import { PublicFooter } from "@/features/public/public-footer";
import { PublicHeader } from "@/features/public/public-header";
import { ViewerShell } from "@/features/shell/viewer-shell";
import { GallerySection } from "../lib/gallery-section";

const STUDIO_NAV_ITEMS = ["Campaigns", "Vouchers", "Reports", "Team"] as const;

const STUDIO_NAV_LINK_CLASS =
  "shrink-0 rounded-control px-3 py-2 text-label font-sans font-medium text-fg-muted hover:bg-surface-sunken";

/**
 * ViewerShell, StudioShell, CounterShell and the public header/footer (task
 * 3.5.c) — every real chrome surface, in fixed-size frames so the visual
 * baselines are stable regardless of the gallery page's own width. Each
 * shell is the exact component the real app renders, not a lookalike.
 */
export function ShellsGroup() {
  return (
    <>
      <GallerySection
        id="viewer-shell"
        title="ViewerShell"
        description="Top bar (wordmark, search, points), bottom nav below 1024px, side rail from 1024px."
      >
        {/* transform-gpu makes the frame the containing block for the shell's fixed
            navs, so they stay inside the frame instead of covering the page. */}
        <div className="h-[640px] w-[390px] max-w-full transform-gpu overflow-hidden rounded-card border border-border-subtle">
          <ViewerShell locale="en-AU" availablePoints={8_400}>
            <div className="flex flex-col gap-3 p-4">
              <p className="text-title font-sans font-semibold text-fg">Home</p>
              <p className="text-body-sm text-fg-muted">
                Route content renders here, under the top bar and clear of the bottom nav.
              </p>
            </div>
          </ViewerShell>
        </div>
      </GallerySection>

      <GallerySection
        id="studio-shell"
        title="StudioShell"
        description="Desktop sidebar for business and staff, collapsing to a top bar below 1024px."
      >
        <div className="h-[480px] w-[1024px] max-w-full overflow-hidden rounded-card border border-border-subtle">
          <StudioShell
            nav={
              <>
                {STUDIO_NAV_ITEMS.map((label) => (
                  <a key={label} href="#" className={STUDIO_NAV_LINK_CLASS}>
                    {label}
                  </a>
                ))}
              </>
            }
            header={
              <p className="text-title font-sans font-semibold text-fg">Campaign performance</p>
            }
          >
            <p className="text-body-sm text-fg-muted">Console content renders here.</p>
          </StudioShell>
        </div>
      </GallerySection>

      <GallerySection
        id="counter-shell"
        title="CounterShell"
        description="Full-height, maximum-contrast, 56px targets for the shared merchant device."
      >
        <div className="h-[640px] w-[390px] max-w-full overflow-hidden rounded-card border border-border-subtle">
          <CounterShell
            header={<span>Warung Kopi Kenangan</span>}
            nav={
              <button
                type="button"
                className="h-14 rounded-control border border-border-control px-4 text-label font-sans font-medium text-fg"
              >
                History
              </button>
            }
          >
            <p className="text-body font-sans text-fg">
              Scan the customer&apos;s voucher QR to redeem.
            </p>
          </CounterShell>
        </div>
      </GallerySection>

      <GallerySection
        id="public-chrome"
        title="Public header and footer"
        description="The anonymous chrome every (public) page shares."
      >
        <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-card border border-border-subtle">
          <PublicHeader locale="en-AU" homeHref="/au" />
          <div className="p-6">
            <p className="text-body-sm text-fg-muted">Public page content renders here.</p>
          </div>
          <PublicFooter locale="en-AU" />
        </div>
      </GallerySection>
    </>
  );
}
