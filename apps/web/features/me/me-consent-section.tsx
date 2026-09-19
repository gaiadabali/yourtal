"use client";

import { Badge } from "@yourtal/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { ME_INTEREST_OPTIONS } from "./me-interest-option";
import { MeConsentToggle } from "./me-consent-toggle";
import type { ConsentPreferences, ConsentPurposeId } from "./me-consent";
import { getMeTranslator, type SupportedLocale } from "./me-i18n";

export interface MeConsentSectionProps {
  locale: SupportedLocale;
  preferences: ConsentPreferences;
  interestIds: readonly string[];
  onPurposeChange: (purpose: ConsentPurposeId, granted: boolean) => void;
}

/**
 * Per-purpose consent (YT-0433's headline criterion: "toggles that visibly
 * take effect"). Each toggle owns a preview directly underneath it that
 * changes the instant the switch is flipped — no page reload, no separate
 * "apply" step — so a user can point at exactly what changed. `essential`
 * is rendered as a locked, always-on row rather than a toggle: it mirrors
 * `features/onboarding/consent-form.tsx`'s own rule that this purpose is
 * required to use the product, and the only way to withdraw it is the
 * account-deletion path below (`me-delete-account-section.tsx`), which this
 * copy points at.
 *
 * `personalize`'s preview reads the live `interestIds` prop, so toggling
 * personalisation on/off AND changing interests in `me-interests-section.tsx`
 * both update this preview immediately — the two controls are genuinely
 * connected, not two screens that happen to mention the same word.
 */
export function MeConsentSection({
  locale,
  preferences,
  interestIds,
  onPurposeChange,
}: MeConsentSectionProps) {
  const t = getMeTranslator(locale);
  // In the order the user picked them (`interestIds`'s own order), not the
  // catalogue's fixed order — the preview reflects what the user actually
  // did, most-recent choices included.
  const selectedLabels = interestIds
    .map((id) => ME_INTEREST_OPTIONS.find((option) => option.id === id))
    .filter((option): option is (typeof ME_INTEREST_OPTIONS)[number] => option !== undefined)
    .map((option) => (locale === "id-ID" ? option.labelId : option.labelEn));

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("consent.heading")}</CardTitle>
        <p className="text-sm font-sans text-fg-muted">{t("consent.intro")}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-surface-raised p-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-sans font-semibold text-fg">
              {t("consent.essentialTitle")}
            </span>
            <span className="text-sm font-sans text-fg-muted">{t("consent.essentialBody")}</span>
          </div>
          <Badge variant="secondary">{t("consent.essentialLockedBadge")}</Badge>
        </div>

        <MeConsentToggle
          id="me-consent-personalize"
          title={t("consent.personalizeTitle")}
          body={t("consent.personalizeBody")}
          checked={preferences.personalize}
          onChange={(granted) => onPurposeChange("personalize", granted)}
        />
        <PersonalizePreview
          heading={t("consent.previewHeading")}
          on={preferences.personalize}
          selectedLabels={selectedLabels}
          onWithInterests={(interests) =>
            t("consent.personalizePreviewOnWithInterests", { interests })
          }
          onNoInterests={t("consent.personalizePreviewOnNoInterests")}
          off={t("consent.personalizePreviewOff")}
        />

        <MeConsentToggle
          id="me-consent-marketing"
          title={t("consent.marketingTitle")}
          body={t("consent.marketingBody")}
          checked={preferences.marketing}
          onChange={(granted) => onPurposeChange("marketing", granted)}
        />
        <MarketingPreview
          heading={t("consent.previewHeading")}
          on={preferences.marketing}
          onHeading={t("consent.marketingPreviewOnHeading")}
          onBody={t("consent.marketingPreviewOnBody")}
          off={t("consent.marketingPreviewOff")}
        />
      </CardContent>
    </Card>
  );
}

interface PersonalizePreviewProps {
  heading: string;
  on: boolean;
  selectedLabels: readonly string[];
  onWithInterests: (interests: string) => string;
  onNoInterests: string;
  off: string;
}

function PersonalizePreview({
  heading,
  on,
  selectedLabels,
  onWithInterests,
  onNoInterests,
  off,
}: PersonalizePreviewProps) {
  const text = on
    ? selectedLabels.length > 0
      ? onWithInterests(selectedLabels.slice(0, 3).join(", "))
      : onNoInterests
    : off;
  return (
    <p
      aria-live="polite"
      className="rounded-md bg-surface-raised px-3 py-2 text-xs font-sans text-fg-muted"
    >
      <span className="font-medium text-fg">{heading}: </span>
      {text}
    </p>
  );
}

interface MarketingPreviewProps {
  heading: string;
  on: boolean;
  onHeading: string;
  onBody: string;
  off: string;
}

function MarketingPreview({ heading, on, onHeading, onBody, off }: MarketingPreviewProps) {
  return (
    <div aria-live="polite" className="rounded-md bg-surface-raised px-3 py-2 text-xs font-sans">
      <span className="font-medium text-fg">{heading}: </span>
      {on ? (
        <span className="text-fg-muted">
          <span className="font-medium text-fg">{onHeading} — </span>
          {onBody}
        </span>
      ) : (
        <span className="text-fg-muted">{off}</span>
      )}
    </div>
  );
}
