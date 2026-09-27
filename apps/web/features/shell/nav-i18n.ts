import type { DisplayLocale } from "@yourtal/contracts/identity/user-profile";
import { makeSyncTranslator } from "@/i18n/sync-translator";
import enAU from "@/messages/en-AU/nav.json";
import idID from "@/messages/id-ID/nav.json";

/** Kept as an alias (6.1.a fold) so existing call sites' imports keep working unchanged. */
export type SupportedLocale = DisplayLocale;

/**
 * Synchronous translator for the `nav` namespace (YT-0058). Same rationale
 * as `apps/web/i18n/sync-translator.ts`: `bottom-nav.tsx` and `side-nav.tsx`
 * are plain (non-`"use client"`) Server Components, so
 * `getTranslations()`/`useTranslations()` are unavailable or the wrong
 * shape here.
 */
export const getNavTranslator = makeSyncTranslator("nav", { "en-AU": enAU, "id-ID": idID });
