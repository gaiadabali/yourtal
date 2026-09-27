import type { DisplayLocale } from "@yourtal/contracts/identity/user-profile";
import { makeSyncTranslator } from "@/i18n/sync-translator";
import enAU from "@/messages/en-AU/campaign.json";
import idID from "@/messages/id-ID/campaign.json";

/** Kept as an alias (6.1.a fold) so existing call sites' imports keep working unchanged. */
export type SupportedLocale = DisplayLocale;

/**
 * Synchronous translator for the `campaign` namespace (YT-0405). Deliberately
 * NOT `getTranslations()`/`useTranslations()`: both of those resolve
 * `messages` from `i18n/request.ts`'s request config, which reads a cookie
 * via `next/headers` — unavailable outside a real Next.js request (Vitest
 * calls these Server Components directly, with no request scope). See
 * `apps/web/i18n/sync-translator.ts` for the shared implementation.
 */
export const getCampaignTranslator = makeSyncTranslator("campaign", {
  "en-AU": enAU,
  "id-ID": idID,
});
