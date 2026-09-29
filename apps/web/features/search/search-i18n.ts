import type { DisplayLocale } from "@yourtal/contracts/identity/user-profile";
import { makeSyncTranslator } from "@/i18n/sync-translator";
import enAU from "@/messages/en-AU/search.json";
import idID from "@/messages/id-ID/search.json";

export type SupportedLocale = DisplayLocale;

/** Synchronous translator for the `search` namespace — see `apps/web/i18n/sync-translator.ts`. */
export const getSearchTranslator = makeSyncTranslator("search", { "en-AU": enAU, "id-ID": idID });
