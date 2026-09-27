import type { DisplayLocale } from "@yourtal/contracts/identity/user-profile";
import { makeSyncTranslator } from "@/i18n/sync-translator";
import enAU from "@/messages/en-AU/quick.json";
import idID from "@/messages/id-ID/quick.json";

/** Kept as an alias (6.1.a fold) so existing call sites' imports keep working unchanged. */
export type SupportedLocale = DisplayLocale;

/** Synchronous translator for the `quick` namespace — see `apps/web/i18n/sync-translator.ts`. */
export const getQuickTranslator = makeSyncTranslator("quick", { "en-AU": enAU, "id-ID": idID });
