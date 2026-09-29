import type { DisplayLocale } from "@yourtal/contracts/identity/user-profile";
import { makeSyncTranslator } from "@/i18n/sync-translator";
import enAU from "@/messages/en-AU/feed.json";
import idID from "@/messages/id-ID/feed.json";

/**
 * A translator for `feedTermsLine` (`features/feed/feed-terms.ts`, Area A's
 * file, not edited here), scoped to the `feed` namespace's own `terms.*`
 * keys. `features/feed/**` has no such helper of its own yet (every
 * existing caller is a client component reaching `useTranslations("feed")`
 * directly) — this is the same one-line `makeSyncTranslator` wrapper every
 * other `*-i18n.ts` file in this app is, kept in `features/search` rather
 * than adding a file to an area this session does not own.
 */
export const getFeedTermsTranslator = makeSyncTranslator("feed", {
  "en-AU": enAU,
  "id-ID": idID,
});

export type FeedLocale = DisplayLocale;
