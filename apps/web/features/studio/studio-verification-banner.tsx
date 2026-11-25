import { Card, CardContent } from "@yourtal/ui/card";
import { getStudioTranslator, type SupportedLocale } from "./studio-i18n";
import type { KybDocument } from "@yourtal/contracts/business/kyb-document";
import { KybDocumentList } from "./onboarding/kyb-upload-form";
import { kybRows } from "./onboarding/kyb-status";

export interface StudioVerificationBannerProps {
  businessId: string;
  /** Documents already sent (read from the API, so it survives a reload). */
  documents: readonly KybDocument[];
  locale: SupportedLocale;
}

/**
 * Shown on the overview while `business.isVerified` is false (7.3.d refuses
 * submitting a campaign for the same reason, red line 7). Uploading does not
 * verify the business; ops approves it in the staff console.
 */
export function StudioVerificationBanner({
  businessId,
  documents,
  locale,
}: StudioVerificationBannerProps) {
  const t = getStudioTranslator(locale);
  return (
    <Card className="border-warning-solid">
      <CardContent className="flex flex-col gap-3 p-4">
        <p className="text-body font-sans font-semibold text-fg">
          {t("chrome.verification.heading")}
        </p>
        {documents.some((doc) => doc.status === "submitted") ? (
          <p className="text-body-sm text-fg-muted" role="status">
            {t("chrome.verification.submittedMessage")}
          </p>
        ) : (
          <p className="text-body-sm text-fg-muted">{t("chrome.verification.intro")}</p>
        )}
        <KybDocumentList businessId={businessId} rows={kybRows(documents)} />
      </CardContent>
    </Card>
  );
}
