import { createTranslator } from "next-intl";
import enAU from "@/messages/en-AU/store.json";
import idID from "@/messages/id-ID/store.json";

export type SupportedLocale = "en-AU" | "id-ID";

const CATALOGUES = { "en-AU": enAU, "id-ID": idID } satisfies Record<SupportedLocale, typeof idID>;

/** Synchronous translator for the `store` namespace — see `campaign-i18n.ts` for why this is `createTranslator`, not `getTranslations()`. */
export function getStoreTranslator(locale: SupportedLocale) {
  return createTranslator({ locale, messages: { store: CATALOGUES[locale] }, namespace: "store" });
}
