import type { DisplayLocale } from "@yourtal/contracts/identity/user-profile";
import { makeSyncTranslator } from "@/i18n/sync-translator";
import enAU from "@/messages/en-AU/checkpoint.json";
import idID from "@/messages/id-ID/checkpoint.json";

/** Kept as an alias (6.1.a fold) so existing call sites' imports keep working unchanged. */
export type SupportedLocale = DisplayLocale;

/**
 * Synchronous translator for the `checkpoint` namespace — see
 * `apps/web/i18n/sync-translator.ts` for why this is `createTranslator`, not
 * `getTranslations()`. Used only by the Server-Component leaves in this
 * feature (`checkpoint-progress.tsx`); the Client Component leaves
 * (`checkpoint-result.tsx`, `checkpoint-timer.tsx`,
 * `checkpoint-question-step.tsx`, `questions/*`) read the same `checkpoint`
 * namespace ambiently via `useTranslations("checkpoint")` instead.
 */
export const getCheckpointTranslator = makeSyncTranslator("checkpoint", {
  "en-AU": enAU,
  "id-ID": idID,
});
