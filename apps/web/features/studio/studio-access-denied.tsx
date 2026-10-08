import { Card, CardContent, CardHeader } from "@yourtal/ui/card";
import { getStudioTranslator, type SupportedLocale } from "./studio-i18n";

export interface StudioAccessDeniedProps {
  zoneLabel: string;
  locale: SupportedLocale;
}

/**
 * Shown when the signed-in person's role does not permit viewing a zone —
 * e.g. a Marketer opening `/studio/team` directly by URL. This is a UI
 * courtesy, not the security boundary (docs/17, docs/14: the server/Cerbos
 * enforces this regardless of what this component does or does not
 * render) — but rendering the zone's real content here anyway would be
 * worse than no UI at all, exactly the failure mode this ticket calls out.
 */
export function StudioAccessDenied({ zoneLabel, locale }: StudioAccessDeniedProps) {
  const t = getStudioTranslator(locale);
  return (
    <Card>
      <CardHeader>
        {/* The page's only heading, so it is the h1 (CardTitle stops at h2). */}
        <h1 className="text-title font-sans text-fg">
          {t("chrome.accessDenied.title", { zoneLabel })}
        </h1>
      </CardHeader>
      <CardContent>
        <p className="text-sm font-sans text-fg-muted">
          {t("chrome.accessDenied.body", { zoneLabel })}
        </p>
      </CardContent>
    </Card>
  );
}
