import { Text } from "@yourtal/ui/text";
import { getGuardianTranslator, type GuardianLocale } from "./guardian-i18n";

export interface GuardianPrivacyNoticeProps {
  displayName: string;
  locale: GuardianLocale;
  /** `GuardianConsentView.region` — picks the public site's own locale segment, "au"/"id" (`apps/web/features/public/public-locale.ts`'s `PublicLocale`), which is NOT the same string as this component's own `locale` prop ("en-AU"/"id-ID"). */
  region: "AU" | "ID";
}

/**
 * 12.4.b (#3, guardian half): one short, plain paragraph on what is kept —
 * shown regardless of state (pending/granted/revoked all render it,
 * `page.tsx`'s own three callers), linking to the full privacy page. A
 * plain `<a>`, not `next/link`: this page has no `[locale]` route segment
 * of its own to prefetch relative to, and the privacy page lives under a
 * different one (`/au/privacy` or `/id/privacy`) entirely.
 */
export function GuardianPrivacyNotice({ displayName, locale, region }: GuardianPrivacyNoticeProps) {
  const t = getGuardianTranslator(locale);
  const privacyPath = `/${region.toLowerCase()}/privacy`;
  return (
    <Text size="body-sm" tone="muted">
      {t("privacy.body", { displayName })}{" "}
      <a href={privacyPath} className="underline">
        {t("privacy.linkLabel")}
      </a>
    </Text>
  );
}
