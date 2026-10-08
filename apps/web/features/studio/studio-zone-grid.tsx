import Link from "next/link";
import type { Route } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import type { StudioNavItem } from "./studio-zone-items";

export interface StudioZoneGridProps {
  items: readonly StudioNavItem[];
  businessQuery: string;
}

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
              <p className="text-sm font-sans text-fg-muted">{item.blurb}</p>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
