import { createTranslator } from "next-intl";
import enAU from "@/messages/en-AU/wallet.json";
import idID from "@/messages/id-ID/wallet.json";

export type SupportedLocale = "en-AU" | "id-ID";

const CATALOGUES = { "en-AU": enAU, "id-ID": idID } satisfies Record<SupportedLocale, typeof idID>;

/** Synchronous translator for the `wallet` namespace — see `campaign-i18n.ts` (features/campaign) for why this is `createTranslator`, not `getTranslations()`. */
export function getWalletTranslator(locale: SupportedLocale) {
  return createTranslator({
    locale,
    messages: { wallet: CATALOGUES[locale] },
    namespace: "wallet",
  });
}
