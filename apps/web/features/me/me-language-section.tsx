import { Card, CardContent, CardHeader, CardTitle } from "@yourtal/ui/card";
import { getMeTranslator, type SupportedLocale } from "./me-i18n";

export interface MeLanguageSectionProps {
  locale: SupportedLocale;
  countryName: string;
  currency: "AUD" | "IDR";
}

/**
 * Language & region — read-only by design, not a stopgap. This ticket
 * cannot touch `app/(app)/layout.tsx` or add an independent locale field to
 * any contract, but even given the room, a working switcher here would
 * contradict `features/onboarding/region-picker.tsx`'s own sign-up copy:
 * "Your region sets your currency, language and consumer protections...
 * this can't be changed later." Region and locale are a 1:1 pair in
 * `@yourtal/contracts/region`'s `REGION_CONFIG` — there is no independent
 * "display language" field to flip without a schema change, which this
 * ticket's brief says to flag rather than build around.
 *
 * **Flag for the architect:** if product wants a Duolingo-style "read the
 * app in English while my region/currency/consumer protections stay
 * Indonesian" (or vice versa), that needs a new field decoupling display
 * locale from region — not a Me-screen change.
 *
 * A Server Component, not a `"use client"` leaf: it only reads and renders
 * ambient values, so it costs this route's client bundle nothing.
 */
export function MeLanguageSection({ locale, countryName, currency }: MeLanguageSectionProps) {
  const t = getMeTranslator(locale);

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("language.heading")}</CardTitle>
        <p className="text-sm font-sans text-fg-muted">{t("language.intro")}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-sm font-sans text-fg">
          <span className="font-medium">{t("language.currentLabel")}: </span>
          {locale === "id-ID" ? "Bahasa Indonesia" : "English"} · {countryName} · {currency}
        </p>
        <p className="text-xs font-sans text-fg-muted">{t("language.fixedNote")}</p>
      </CardContent>
    </Card>
  );
}
