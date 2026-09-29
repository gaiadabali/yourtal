import type { DisplayLocale } from "@yourtal/contracts/identity/user-profile";
import { makeSyncTranslator } from "@/i18n/sync-translator";
import enAU from "@/messages/en-AU/guardian.json";
import idID from "@/messages/id-ID/guardian.json";

/**
 * Synchronous translator for the `guardian` namespace — see
 * `apps/web/i18n/sync-translator.ts` for why this is `createTranslator`
 * rather than `getTranslations()`/`useTranslations()`: both resolve
 * `messages` from `i18n/request.ts`, which reads the `yt_locale` cookie via
 * `next/headers`. `/guardian/[token]` has no session and must not read a
 * cookie at all (12.2.c's own brief) — the guardian's language comes from
 * `GET /api/guardian/:token`'s own `locale` field (the teen's display
 * locale), never from this browser's cookies. Same reason
 * `features/player/player-i18n.ts` exists: usable from a plain Server
 * Component with no request scope, AND from a "use client" leaf with no
 * `NextIntlClientProvider` ancestor.
 */
export const getGuardianTranslator = makeSyncTranslator("guardian", {
  "en-AU": enAU,
  "id-ID": idID,
});

export type GuardianLocale = DisplayLocale;
