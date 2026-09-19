import Link from "next/link";
import type { Route } from "next";

export interface ReportsCampaignFilterOption {
  id: string;
  label: string;
}

export interface ReportsCampaignFilterProps {
  options: readonly ReportsCampaignFilterOption[];
  /** `undefined` means "All campaigns" — the state this filter defaults to and can always return to. */
  selectedCampaignId: string | undefined;
  /** `""` or `"?business=<id>"`, carried through unchanged so switching the campaign filter never loses the business switcher's selection. */
  businessQuery: string;
}

const REPORTS_PATH = "/business/reports";

/**
 * A plain Server Component, NOT a `"use client"` leaf — it renders links
 * that change the URL and needs no state, effect, event handler or
 * browser API (docs/13b-typescript-standards.md §8's own test for when a
 * file earns `"use client"`). Same reasoning `campaign-board-controls.tsx`
 * gives for its kind filter: a set of links that change the URL is not an
 * ARIA tabs widget and does not need client JS to work.
 *
 * State lives entirely in the `?campaign=` query param, appended to
 * whatever `businessQuery` already carries — never local component state
 * — so the URL stays shareable and the back button stays correct.
 */
export function ReportsCampaignFilter({
  options,
  selectedCampaignId,
  businessQuery,
}: ReportsCampaignFilterProps) {
  const separator = businessQuery ? "&" : "?";

  return (
    <nav
      aria-label="Filter reports by campaign"
      className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-surface-raised p-1"
    >
      <Link
        href={`${REPORTS_PATH}${businessQuery}` as Route}
        aria-current={selectedCampaignId === undefined ? "page" : undefined}
        className={
          selectedCampaignId === undefined
            ? "rounded-md bg-primary px-3 py-1.5 text-sm font-sans font-medium text-primary-fg"
            : "rounded-md px-3 py-1.5 text-sm font-sans text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        }
      >
        All campaigns
      </Link>
      {options.map((option) => {
        const isActive = option.id === selectedCampaignId;
        return (
          <Link
            key={option.id}
            href={`${REPORTS_PATH}${businessQuery}${separator}campaign=${option.id}` as Route}
            aria-current={isActive ? "page" : undefined}
            className={
              isActive
                ? "rounded-md bg-primary px-3 py-1.5 text-sm font-sans font-medium text-primary-fg"
                : "rounded-md px-3 py-1.5 text-sm font-sans text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            }
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}
