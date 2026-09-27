import type { DisplayLocale } from "@yourtal/contracts/identity/user-profile";
import { makeSyncTranslator } from "@/i18n/sync-translator";
import enAU from "@/messages/en-AU/public.json";
import idID from "@/messages/id-ID/public.json";

/** Kept as an alias (6.1.a fold) so existing call sites' imports keep working unchanged. */
export type SupportedLocale = DisplayLocale;

/**
 * Synchronous translator for the `public` message namespace — see
 * `apps/web/i18n/sync-translator.ts` for why this is `createTranslator`
 * rather than `getTranslations()`/`useTranslations()`: both of those resolve
 * `messages` from `i18n/request.ts`, which reads a cookie via `next/headers`
 * and would force every public route dynamic, exactly what this ticket must
 * not do (docs/13b-typescript-standards.md §8, docs/11-seo-aeo-geo.md §1).
 * Fed the catalogue for whatever locale the `[locale]` route param resolved
 * to (`apps/web/features/public/public-locale.ts`).
 */
export const getPublicTranslator = makeSyncTranslator("public", { "en-AU": enAU, "id-ID": idID });
