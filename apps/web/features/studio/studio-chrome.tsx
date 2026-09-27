import type { ReactNode } from "react";
import { StudioShell } from "@yourtal/ui/studio-shell";
import { RegionProvider } from "@/features/region/region-context";
import type { BusinessMembership } from "./studio-data";
import { StudioIdentityPanel } from "./studio-identity-panel";
import { StudioZoneNav } from "./studio-zone-nav";
import { buildStudioNavItems } from "./studio-zone-items";
import { getVisibleZones } from "./studio-zone-access";

export interface StudioChromeProps {
  current: BusinessMembership;
  allMemberships: readonly BusinessMembership[];
  defaultBusinessId: string;
  /** A page-level title/actions row, usually `<PageHeader/>` — passed straight to `StudioShell`'s `header` slot. */
  header?: ReactNode;
  children: ReactNode;
}

/**
 * Every `/studio/**` page wraps its content in this (task 7.8.a). It
 * composes the real `StudioShell` primitive (`packages/ui`, task 3.5.c) with
 * this feature's own business identity + zone nav, rather than being a
 * shell of its own — `StudioShell` already owns the responsive sidebar/strip
 * layout and the `data-surface="studio"` theming.
 *
 * Not a `layout.tsx`: Next's App Router does not hand a layout
 * `searchParams`, and `?business=` (the switcher's own state) is a
 * `searchParams` value, so every zone `page.tsx` resolves its own
 * `StudioContext` and wraps itself here — see `studio-context.ts`'s doc
 * comment for the same reasoning under its previous name. Server Component
 * end to end — the only client leaves are inside `StudioIdentityPanel` and
 * `StudioZoneNav`.
 */
export function StudioChrome({
  current,
  allMemberships,
  defaultBusinessId,
  header,
  children,
}: StudioChromeProps) {
  const businessQuery =
    current.business.id === defaultBusinessId ? "" : `?business=${current.business.id}`;
  const visibleZones = current.myRole
    ? getVisibleZones(current.myRole, current.business.roles)
    : [];
  const navItems = buildStudioNavItems(visibleZones);

  return (
    // The BUSINESS's own region, never the viewer's personal one — a client
    // leaf anywhere below (e.g. `campaign-editor-reward.tsx`'s `useRegion()`)
    // must format money in the currency the data actually belongs to
    // (task 3.4.b's `MoneyAmount` rule), and the two can differ in
    // principle even though one person holds one region (CLAUDE.md).
    <RegionProvider region={current.business.region}>
      <StudioShell
        nav={
          <>
            <StudioIdentityPanel
              current={current}
              allMemberships={allMemberships}
              defaultBusinessId={defaultBusinessId}
            />
            <StudioZoneNav items={navItems} businessQuery={businessQuery} />
          </>
        }
        header={header}
      >
        {children}
      </StudioShell>
    </RegionProvider>
  );
}
