import Link from "next/link";
import type { Route } from "next";
import { cn } from "@yourtal/ui/cn";

export interface StaffRegionSwitchProps {
  readonly basePath: string;
  readonly current: "AU" | "ID";
  readonly label: string;
  readonly regionLabels: Record<"AU" | "ID", string>;
}

/**
 * TASKS.md 9.5: every economy screen shows ONE region at a time (F2), never
 * a combined number -- this is how a staff member switches which. A server
 * component, not `SegmentedControl` (which is a controlled radiogroup that
 * needs client state): the region genuinely lives in the URL
 * (`?region=AU|ID`), so a plain link works with no JS at all, same as
 * `StaffUsersSearchForm`'s region select.
 */
export function StaffRegionSwitch({
  basePath,
  current,
  label,
  regionLabels,
}: StaffRegionSwitchProps) {
  const regions: readonly ("AU" | "ID")[] = ["AU", "ID"];
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex w-fit rounded-control border border-border-subtle p-1"
    >
      {regions.map((region) => {
        const active = region === current;
        return (
          <Link
            key={region}
            href={`${basePath}?region=${region}` as Route}
            role="radio"
            aria-checked={active}
            className={cn(
              "rounded-control px-3 py-1.5 text-label font-sans font-medium transition-colors",
              active ? "bg-surface-sunken text-fg" : "text-fg-muted hover:bg-surface-sunken",
            )}
          >
            {regionLabels[region]}
          </Link>
        );
      })}
    </div>
  );
}
