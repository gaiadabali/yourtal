"use client";

import { useId } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import Link from "next/link";
import { buildCampaignBoardQuery, parseCampaignBoardParams } from "./campaign-board-params";
import { CAMPAIGN_KIND_FILTER_OPTIONS } from "./campaign-filter";
import { CAMPAIGN_SORT_OPTIONS, isCampaignSortKey } from "./campaign-sort";

/**
 * The earn board's filter (kind) and sort controls. The only client
 * component in this feature's board: state lives in the URL, not
 * `useState` (docs/13b-typescript-standards.md §8), so this component's
 * whole job is translating a user interaction into a `router.push` with an
 * updated query string — it holds no state of its own.
 *
 * The kind filter is a set of LINKS, not a Radix `Tabs`. It changes the URL
 * rather than swapping an in-page panel, and the ARIA tabs pattern expects a
 * tablist to control tabpanels in the same document — using it for
 * navigation is an anti-pattern that also costs bundle weight. Links give
 * the right semantics, real href affordances (middle-click, open in new
 * tab), and `aria-current="page"` for the active filter.
 *
 * Sort uses a NATIVE `<select>`, not `@yourtal/ui/select`. Radix Select
 * pulls in Popper and floating-ui, which cost ~30 KB gz on this route and
 * put it over the 170 KB initial-JS gate (docs/13b §8) — for a plain
 * single-choice list that a native control already handles, with a better
 * picker on the mid-tier Android this app targets (docs/08 §3). Radix
 * Select stays the right choice where a trigger needs rich content.
 */
export function CampaignBoardControls() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sortId = useId();
  const current = parseCampaignBoardParams(Object.fromEntries(searchParams.entries()));

  function navigate(update: Parameters<typeof buildCampaignBoardQuery>[1]) {
    // typedRoutes only validates literal href strings; `pathname` is
    // request-time data, so this computed URL needs the documented `Route`
    // cast. Safe here: it is built from `usePathname()` (the current,
    // already-valid route) plus a query string this file itself constructs.
    router.push(`${pathname}${buildCampaignBoardQuery(current, update)}` as Route);
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <nav
        aria-label="Filter jenis campaign"
        className="flex items-center gap-1 rounded-lg border border-border bg-surface-raised p-1"
      >
        {CAMPAIGN_KIND_FILTER_OPTIONS.map((option) => {
          const isActive = option.key === current.kind;
          return (
            <Link
              key={option.key}
              href={`${pathname}${buildCampaignBoardQuery(current, { kind: option.key })}` as Route}
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

      <div className="flex items-center gap-2 text-sm font-sans text-fg-muted">
        <label htmlFor={sortId} className="shrink-0">
          {/* Visible text stays short; the accessible name stays complete. */}
          {"Urutkan "}
          <span className="sr-only">campaign</span>
        </label>
        <select
          id={sortId}
          value={current.sort}
          onChange={(event) => {
            const sort = event.target.value;
            if (isCampaignSortKey(sort)) {
              navigate({ sort });
            }
          }}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm font-sans text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-48"
        >
          {CAMPAIGN_SORT_OPTIONS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
