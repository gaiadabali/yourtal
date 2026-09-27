import type { DisplayLocale } from "@yourtal/contracts/identity/user-profile";
import { makeSyncTranslator } from "@/i18n/sync-translator";
import enAU from "@/messages/en-AU/studio.json";
import idID from "@/messages/id-ID/studio.json";

/** Kept as an alias (6.1.a fold) so existing call sites' imports keep working unchanged. */
export type SupportedLocale = DisplayLocale;

/**
 * Synchronous translator for the `studio` namespace — see
 * `apps/web/i18n/sync-translator.ts` for why this is `createTranslator`, not
 * `getTranslations()`: several Server-Component leaves under
 * `features/studio/reports/**` and `features/studio/**` are exercised
 * directly by `render()` in Vitest/RTL, which cannot render an `async`
 * component.
 *
 * `locale` is required, not defaulted: every call site threads the signed-in
 * business owner's real display locale down from `getDisplayLocale()`
 * (`apps/web/i18n/get-locale.ts`, resolved once per request in
 * `(business)/layout.tsx` or a page.tsx and passed through as a plain
 * `locale: SupportedLocale` prop), mirroring `getCheckpointTranslator`'s
 * `locale` prop — a caller that forgets to pass it is now a compile error,
 * not a silent `en-AU` fallback.
 */
export const getStudioTranslator = makeSyncTranslator("studio", {
  "en-AU": enAU,
  "id-ID": idID,
});
