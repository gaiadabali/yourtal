import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";

export interface ConsoleZonePlaceholderProps {
  zoneLabel: string;
  ticketId: string;
}

/**
 * Every zone this shell links to but does not build content for yet
 * (Campaigns/YT-0441, Inventory/part of YT-0441, Redemption/YT-0445-0446,
 * Reports/YT-0443, Billing/no ticket in this phase). Honest "not built
 * yet" rather than a 404 — the shell's job (YT-0440) is to make the zone
 * structure real and navigable even before each zone's own ticket lands.
 */
export function ConsoleZonePlaceholder({ zoneLabel, ticketId }: ConsoleZonePlaceholderProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{zoneLabel}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm font-sans text-fg-muted">
          This zone&rsquo;s content is not built yet — see {ticketId}. The console shell (YT-0440)
          makes it navigable and access-gated ahead of that work landing.
        </p>
      </CardContent>
    </Card>
  );
}
