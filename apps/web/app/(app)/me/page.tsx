import { getRegionDisplayConfig } from "@/features/region/get-region";
import { getMeTranslator } from "@/features/me/me-i18n";
import { MeSettingsClient } from "@/features/me/me-settings-client";
import { MeLanguageSection } from "@/features/me/me-language-section";
import { MeSecuritySection } from "@/features/me/me-security-section";
import { MeReferralsSection } from "@/features/me/me-referrals-section";
import { MeDeleteAccountSection } from "@/features/me/me-delete-account-section";

/**
 * The Me tab (YT-0433, replacing YT-0402's placeholder — docs/17-surfaces-and-roles.md
 * §1.1: "profile, declared interests, per-purpose consent toggles that
 * actually work, security (passkey), language, referrals").
 *
 * A Server Component, per docs/13b-typescript-standards.md §8 ("`page.tsx`
 * stays a Server Component; toggles are `\"use client\"` leaves"): it only
 * resolves the ambient region/locale and passes it down. Every interactive
 * piece is its own client leaf (`MeSettingsClient` for consent + interests,
 * which must share live state; `MeSecuritySection`, `MeReferralsSection` and
 * `MeDeleteAccountSection` independently, since none of them need to react
 * to each other). `MeLanguageSection` stays a Server Component entirely —
 * see its own docstring for why Language is read-only in this build rather
 * than a switcher.
 */
export default async function MePage() {
  const { locale, currency, countryName } = await getRegionDisplayConfig();
  const t = getMeTranslator(locale);

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-sans font-semibold text-fg">{t("page.heading")}</h1>
        <p className="text-sm font-sans text-fg-muted">{t("page.intro")}</p>
      </header>

      <MeSettingsClient locale={locale} />
      <MeLanguageSection locale={locale} countryName={countryName} currency={currency} />
      <MeSecuritySection locale={locale} />
      <MeReferralsSection locale={locale} />
      <MeDeleteAccountSection locale={locale} />
    </div>
  );
}
