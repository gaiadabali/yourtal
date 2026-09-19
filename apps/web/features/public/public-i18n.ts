import { createTranslator } from "next-intl";
import enAU from "@/messages/en-AU/public.json";
import idID from "@/messages/id-ID/public.json";

export type SupportedLocale = "en-AU" | "id-ID";

const CATALOGUES = { "en-AU": enAU, "id-ID": idID } satisfies Record<SupportedLocale, typeof idID>;

/**
 * Synchronous translator for the `public` message namespace — see
 * `apps/web/features/campaign/campaign-i18n.ts` for why this is
 * `createTranslator` rather than `getTranslations()`/`useTranslations()`:
 * both of those resolve `messages` from `i18n/request.ts`, which reads the
 * region cookie via `next/headers` and would force every public route
 * dynamic, exactly what this ticket must not do
 * (docs/13b-typescript-standards.md §8, docs/11-seo-aeo-geo.md §1).
 * `createTranslator` is the same primitive, fed the catalogue for whatever
 * locale the `[locale]` route param resolved to
 * (`apps/web/features/public/public-locale.ts`).
 */
export function getPublicTranslator(locale: SupportedLocale) {
  return createTranslator({
    locale,
    messages: { public: CATALOGUES[locale] },
    namespace: "public",
  });
}
