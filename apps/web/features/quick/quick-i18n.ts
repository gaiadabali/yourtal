import { createTranslator } from "next-intl";
import enAU from "@/messages/en-AU/quick.json";
import idID from "@/messages/id-ID/quick.json";

export type SupportedLocale = "en-AU" | "id-ID";

const CATALOGUES = { "en-AU": enAU, "id-ID": idID } satisfies Record<SupportedLocale, typeof idID>;

/** Synchronous translator for the `quick` namespace — see `campaign-i18n.ts` for why this is `createTranslator`, not `getTranslations()`. */
export function getQuickTranslator(locale: SupportedLocale) {
  return createTranslator({ locale, messages: { quick: CATALOGUES[locale] }, namespace: "quick" });
}
