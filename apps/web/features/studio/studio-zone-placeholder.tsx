import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { getStudioTranslator } from "./studio-i18n";

export interface StudioZonePlaceholderProps {
  zoneLabel: string;
}

/**
 * A zone this shell links to but does not build content for yet — honest
 * "not built yet" rather than a 404, still access-gated exactly like every
 * built zone. Only Redemptions uses this today (task 7.8.b/8.2.g: the real
 * screen needs the counter-device and voucher-engine APIs Phase 8 builds).
 */
export function StudioZonePlaceholder({ zoneLabel }: StudioZonePlaceholderProps) {
  const t = getStudioTranslator();
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{zoneLabel}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-body-sm text-fg-muted">
          {t("chrome.zonePlaceholder.body", { zoneLabel })}
        </p>
      </CardContent>
    </Card>
  );
}
