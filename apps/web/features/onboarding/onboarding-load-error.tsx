import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import { ErrorState } from "@yourtal/ui/error-state";

export interface OnboardingLoadErrorProps {
  /** Where the user's own retry (a fresh navigation) should land — this step's own path, so a retry re-runs exactly this read. */
  retryHref: string;
}

/**
 * The one state every onboarding step needs and none of them can recover
 * from on its own: the read it needs to even render (consents, interests,
 * follow candidates) failed. A Server Component, so retry is a real
 * navigation (`<a>`, not `window.location.reload()` — there is no client
 * boundary here to hold an onClick).
 */
export function OnboardingLoadError({ retryHref }: OnboardingLoadErrorProps) {
  const t = useTranslations("onboarding.common");
  return (
    <ErrorState
      title={t("errorTitle")}
      description={t("errorBody")}
      retry={
        <Button asChild variant="secondary" size="sm">
          <a href={retryHref}>{t("retryCta")}</a>
        </Button>
      }
    />
  );
}
