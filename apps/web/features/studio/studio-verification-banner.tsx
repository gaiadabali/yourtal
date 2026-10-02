import { Card, CardContent } from "@yourtal/ui/card";
import { getStudioTranslator, type SupportedLocale } from "./studio-i18n";
import { KybUploadForm } from "./onboarding/kyb-upload-form";

export interface StudioVerificationBannerProps {
  businessId: string;
  /** Documents already sent and waiting for ops (read from the API, so it survives a reload). */
  underReview: boolean;
  locale: SupportedLocale;
}

/**
 * Shown on the overview while `business.isVerified` is false (7.3.d refuses
 * submitting a campaign for the same reason, red line 7). Uploading does not
 * verify the business; ops approves it in the staff console.
 */
export function StudioVerificationBanner({
  businessId,
  underReview,
  locale,
}: StudioVerificationBannerProps) {
  const t = getStudioTranslator(locale);
  return (
    <Card className="border-warning-solid">
      <CardContent className="flex flex-col gap-3 p-4">
        <p className="text-body font-sans font-semibold text-fg">
          {t("chrome.verification.heading")}
        </p>
        {underReview ? (
          <p className="text-body-sm text-fg-muted" role="status">
            {t("chrome.verification.submittedMessage")}
          </p>
        ) : (
          <KybUploadForm businessId={businessId} />
        )}
      </CardContent>
    </Card>
  );
}
