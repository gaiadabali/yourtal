import { createTranslator } from "next-intl";
import enAU from "@/messages/en-AU/nav.json";
import idID from "@/messages/id-ID/nav.json";

export type SupportedLocale = "en-AU" | "id-ID";

const CATALOGUES = { "en-AU": enAU, "id-ID": idID } satisfies Record<SupportedLocale, typeof idID>;

/**
 * Synchronous translator for the `nav` namespace (YT-0058). Same rationale
 * as `features/campaign/campaign-i18n.ts`: `bottom-nav.tsx` and
 * `side-nav.tsx` are plain (non-`"use client"`) Server Components, so
 * `getTranslations()`/`useTranslations()` are unavailable or the wrong
 * shape here — this is the same primitive fed by catalogues imported
 * directly, safe to call from a synchronous Server Component and from
 * tests with no request scope.
 */
export function getNavTranslator(locale: SupportedLocale) {
  return createTranslator({
    locale,
    messages: { nav: CATALOGUES[locale] },
    namespace: "nav",
  });
}
