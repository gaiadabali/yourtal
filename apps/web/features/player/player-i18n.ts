import type { DisplayLocale } from "@yourtal/contracts/identity/user-profile";
import { makeSyncTranslator } from "@/i18n/sync-translator";
import enAU from "@/messages/en-AU/player.json";
import idID from "@/messages/id-ID/player.json";

/** 6.1.d: the player had zero translator or catalogue calls (0 of 10 components). */
export type SupportedLocale = DisplayLocale;

/**
 * Synchronous translator for the `player` namespace — see
 * `apps/web/i18n/sync-translator.ts`. Every player component already
 * requires an explicit `locale` prop (no default, 6.1.c), threaded down
 * from `video-player.tsx`, so this is callable everywhere the same way.
 */
export const getPlayerTranslator = makeSyncTranslator("player", { "en-AU": enAU, "id-ID": idID });
