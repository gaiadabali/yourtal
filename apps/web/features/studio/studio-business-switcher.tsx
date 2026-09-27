"use client";

import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { NativeSelect } from "@yourtal/ui/native-select";

export interface StudioBusinessOption {
  id: string;
  displayName: string;
  /** The viewer's own role at this business — shown next to the name so a switch never surprises with a sudden capability change. */
  myRole: string;
}

export interface StudioBusinessSwitcherProps {
  options: readonly StudioBusinessOption[];
  currentBusinessId: string;
  /** The business shown when `?business=` is absent — switching back to it clears the query param rather than pinning it. */
  defaultBusinessId: string;
}

/**
 * A native `<select>`, not `@yourtal/ui/select` (Radix) — a plain business
 * picker has no need for Radix's extra JS weight, and
 * docs/13b-typescript-standards.md §8's budget explicitly asks to "prefer
 * native controls where native does the job." Only rendered at all when
 * the signed-in person holds a role at more than one business
 * (`studio-header.tsx` skips it entirely for the single-business case,
 * which is most of them).
 *
 * Switching business keeps the current zone (Team stays Team) and carries
 * the choice as a `?business=` query param rather than local state, so the
 * URL is shareable and the back button works (docs/13b §8's "URL first").
 */
export function StudioBusinessSwitcher({
  options,
  currentBusinessId,
  defaultBusinessId,
}: StudioBusinessSwitcherProps) {
  const t = useTranslations("studio");
  const router = useRouter();
  const pathname = usePathname();

  // `min-w-0` below is load-bearing: without it this flex item refuses to
  // shrink below its content, so a long business name sizes the closed
  // <select> open. Playwright measured /business overflowing to 674px at a
  // 320px viewport (354px over) on the 78-character `longNameBusinessFixture`.
  return (
    <NativeSelect
      label={t("chrome.businessSwitcher.label")}
      id="studio-business-switcher"
      value={currentBusinessId}
      onChange={(event) => {
        const nextId = event.target.value;
        const query = nextId === defaultBusinessId ? "" : `?business=${nextId}`;
        router.push(`${pathname}${query}` as Route);
      }}
      className="min-w-0 max-w-full truncate"
    >
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.displayName} — {option.myRole}
        </option>
      ))}
    </NativeSelect>
  );
}
