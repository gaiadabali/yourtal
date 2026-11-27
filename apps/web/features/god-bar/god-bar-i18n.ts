import { makeSyncTranslator } from "@/i18n/sync-translator";
import enAU from "@/messages/en-AU/godBar.json";
import idID from "@/messages/id-ID/godBar.json";

/** The switcher panel's strings. Only the panel imports this, so they load with it, not with the shell. */
export const getGodBarTranslator = makeSyncTranslator("godBar", { "en-AU": enAU, "id-ID": idID });
