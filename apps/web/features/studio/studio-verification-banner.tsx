import { Button } from "@yourtal/ui/button";
import { NativeSelect } from "@yourtal/ui/native-select";
import { Card, CardContent } from "@yourtal/ui/card";
import { getStudioTranslator, type SupportedLocale } from "./studio-i18n";
import { submitKybDocumentAction } from "./onboarding/submit-kyb-action";

const KYB_DOCUMENT_TYPE_VALUES = [
  "business_registration_certificate",
  "tax_registration_number",
  "director_identity",
  "proof_of_address",
] as const;

export interface StudioVerificationBannerProps {
  justSubmitted: boolean;
  locale: SupportedLocale;
}

/**
 * "A verification banner that blocks submit" (task 7.8.b) — shown on the
 * overview whenever `business.isVerified` is false (7.3.d refuses
 * submitting a campaign for the same reason, red line 7). Uploading here
 * does not verify the business itself; see `submit-kyb-action.ts` for why.
 */
export function StudioVerificationBanner({ justSubmitted, locale }: StudioVerificationBannerProps) {
  const t = getStudioTranslator(locale);
  const kybDocumentTypes = KYB_DOCUMENT_TYPE_VALUES.map((value) => ({
    value,
    label: t(`chrome.verification.documentType.${value}`),
  }));

  return (
    <Card className="border-warning-solid">
      <CardContent className="flex flex-col gap-3 p-4">
        <p className="text-body font-sans font-semibold text-fg">
          {t("chrome.verification.heading")}
        </p>
        {justSubmitted ? (
          <p className="text-body-sm text-fg-muted" role="status">
            {t("chrome.verification.submittedMessage")}
          </p>
        ) : (
          <form
            action={submitKybDocumentAction}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <NativeSelect
              name="documentType"
              label={t("chrome.verification.documentTypeLabel")}
              required
              defaultValue={kybDocumentTypes[0]?.value}
              className="sm:max-w-xs"
            >
              {kybDocumentTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </NativeSelect>
            <label className="flex flex-col gap-1.5">
              <span className="text-label font-sans text-fg">
                {t("chrome.verification.fileLabel")}
              </span>
              <input
                type="file"
                name="document"
                required
                accept="application/pdf,image/*"
                className="text-body-sm text-fg"
              />
            </label>
            <Button type="submit" className="w-fit">
              {t("chrome.verification.submit")}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
