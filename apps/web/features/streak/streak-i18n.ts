import { createTranslator } from "next-intl";
import enAU from "@/messages/en-AU/streak.json";
import idID from "@/messages/id-ID/streak.json";

export type SupportedLocale = "en-AU" | "id-ID";

const CATALOGUES = { "en-AU": enAU, "id-ID": idID } satisfies Record<SupportedLocale, typeof idID>;

/**
 * Synchronous translator for the `streak` namespace (YT-0177) — see
 * `features/campaign/campaign-i18n.ts` for why `createTranslator` rather
 * than `getTranslations()`/`useTranslations()`, and why this is
 * deliberately NOT registered in `apps/web/i18n/request.ts`'s
 * `FeatureNamespace` union (see `features/me/me-i18n.ts`'s doc comment —
 * same reasoning, copied deliberately rather than re-litigated per file).
 */
export function getStreakTranslator(locale: SupportedLocale) {
  return createTranslator({
    locale,
    messages: { streak: CATALOGUES[locale] },
    namespace: "streak",
  });
}
