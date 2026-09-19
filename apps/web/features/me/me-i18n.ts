import { createTranslator } from "next-intl";
import enAU from "@/messages/en-AU/me.json";
import idID from "@/messages/id-ID/me.json";

export type SupportedLocale = "en-AU" | "id-ID";

const CATALOGUES = { "en-AU": enAU, "id-ID": idID } satisfies Record<SupportedLocale, typeof idID>;

/**
 * Synchronous translator for the `me` namespace (YT-0433) — see
 * `features/campaign/campaign-i18n.ts` for why this is `createTranslator`,
 * not `getTranslations()`/`useTranslations()`.
 *
 * Deliberately NOT registered in `apps/web/i18n/request.ts`'s
 * `FeatureNamespace` union: that file is outside this ticket's owned paths
 * (`app/(app)/me/**`, `features/me/**`), and this translator does not need
 * it — it imports both locales' catalogues directly, the same self-contained
 * pattern `features/wallet/wallet-i18n.ts` already uses for its client
 * leaves (`wallet-balance-summary.tsx`, `wallet-voucher-card.tsx`, etc.),
 * so it works from a client component, a plain Server Component, or a test,
 * with no dependency on the ambient `NextIntlClientProvider` context.
 */
export function getMeTranslator(locale: SupportedLocale) {
  return createTranslator({
    locale,
    messages: { me: CATALOGUES[locale] },
    namespace: "me",
  });
}
