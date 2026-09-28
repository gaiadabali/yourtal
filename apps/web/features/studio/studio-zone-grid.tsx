import Link from "next/link";
import type { Route } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import type { StudioNavItem } from "./studio-zone-items";

export interface StudioZoneGridProps {
  items: readonly StudioNavItem[];
  businessQuery: string;
}

const ZONE_BLURBS: Record<StudioNavItem["zone"], string> = {
  campaigns: "Video campaigns, chapters, question banks, targeting and budget.",
  inventory: "Listings, settlement value, stock and redemption policy.",
  reports: "Completion, accuracy, recall and redemption attribution.",
  billing: "Buy points, balance and purchase history.",
  team: "Members, roles, invitations and the audit trail.",
  redemptions: "Today's and recent voucher captures, per location and device.",
  developers: "API credentials, webhooks and the integration docs.",
  channel: "Logo, cover image and your public handle.",
};

/**
 * The `/studio` overview once setup is complete: one card per zone the
 * signed-in person's role permits on this business — `items` already
 * reflects both the relationship gate and the role gate, computed once in
 * `studio-chrome.tsx` so this component stays a plain presentational list.
 */
export function StudioZoneGrid({ items, businessQuery }: StudioZoneGridProps) {
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
