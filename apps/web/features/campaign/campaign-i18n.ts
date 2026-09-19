import { createTranslator } from "next-intl";
import enAU from "@/messages/en-AU/campaign.json";
import idID from "@/messages/id-ID/campaign.json";

export type SupportedLocale = "en-AU" | "id-ID";

const CATALOGUES = { "en-AU": enAU, "id-ID": idID } satisfies Record<SupportedLocale, typeof idID>;

/**
 * Synchronous translator for the `campaign` namespace (YT-0405). Deliberately
 * NOT `getTranslations()`/`useTranslations()`: both of those resolve
 * `messages` from `i18n/request.ts`'s request config, which reads the region
 * cookie via `next/headers` — unavailable outside a real Next.js request
 * (Vitest calls these Server Components directly, with no request scope).
 * `createTranslator` is the same primitive next-intl builds both of those
 * on top of (`next-intl` re-exports it from `use-intl/core`), fed here by
 * the catalogues imported directly — a pure function with no server-only
 * dependency, safe to call from a plain synchronous Server Component and
 * from its tests alike.
 */
export function getCampaignTranslator(locale: SupportedLocale) {
  return createTranslator({
    locale,
    messages: { campaign: CATALOGUES[locale] },
    namespace: "campaign",
  });
}
