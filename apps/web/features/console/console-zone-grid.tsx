import Link from "next/link";
import type { Route } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import type { ConsoleNavItem } from "./console-zone-items";

export interface ConsoleZoneGridProps {
  items: readonly ConsoleNavItem[];
  businessQuery: string;
}

const ZONE_BLURBS: Record<ConsoleNavItem["zone"], string> = {
  campaigns: "Video campaigns, chapters, question banks, targeting and budget.",
  inventory: "Listings, settlement value, stock and redemption policy.",
  redemption: "Manual code lookup, redemption log and integration status.",
  reports: "Completion, accuracy, recall and redemption attribution.",
  billing: "Point pre-purchases, settlement statements and invoices.",
  team: "Members, roles, invitations and the audit trail.",
};

/**
 * The `/business` overview: one card per zone the signed-in person's role
 * permits on this business (YT-0440: "three zones shown only when the
 * business holds that relationship" — `items` already reflects both that
 * relationship gate and the role gate, computed once in `console-shell.tsx`
 * so this component stays a plain presentational list).
 */
export function ConsoleZoneGrid({ items, businessQuery }: ConsoleZoneGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <Link key={item.zone} href={`${item.href}${businessQuery}` as Route} className="block">
          <Card className="h-full transition-colors hover:bg-surface-raised">
            <CardHeader>
              <CardTitle as="h2">{item.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm font-sans text-fg-muted">{ZONE_BLURBS[item.zone]}</p>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
