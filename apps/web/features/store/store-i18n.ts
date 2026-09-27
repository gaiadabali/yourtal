import type { DisplayLocale } from "@yourtal/contracts/identity/user-profile";
import { makeSyncTranslator } from "@/i18n/sync-translator";
import enAU from "@/messages/en-AU/store.json";
import idID from "@/messages/id-ID/store.json";

/** Kept as an alias (6.1.a fold) so existing call sites' imports keep working unchanged. */
export type SupportedLocale = DisplayLocale;

/** Synchronous translator for the `store` namespace — see `apps/web/i18n/sync-translator.ts`. */
export const getStoreTranslator = makeSyncTranslator("store", { "en-AU": enAU, "id-ID": idID });
