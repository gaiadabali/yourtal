import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { getStudioTranslator, type SupportedLocale } from "./studio-i18n";

/**
 * Shown when the signed-in person holds no role at any business — an
 * ordinary consumer who has navigated to `/business` directly. Honest
 * empty state rather than a dead end: explains what the console is for
 * and that reaching it requires being invited or registering a business,
 * neither of which this ticket builds (registration is a future ticket;
 * onboarding is owned by a parallel session).
 */
export interface StudioNoBusinessProps {
  locale: SupportedLocale;
}

export function StudioNoBusiness({ locale }: StudioNoBusinessProps) {
  const t = getStudioTranslator(locale);
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold text-fg">{t("chrome.noBusiness.pageTitle")}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t("chrome.noBusiness.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm font-sans text-fg-muted">{t("chrome.noBusiness.body")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
