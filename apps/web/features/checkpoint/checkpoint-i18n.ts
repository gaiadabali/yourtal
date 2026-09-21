import { createTranslator } from "next-intl";
import enAU from "@/messages/en-AU/checkpoint.json";
import idID from "@/messages/id-ID/checkpoint.json";

export type SupportedLocale = "en-AU" | "id-ID";

const CATALOGUES = { "en-AU": enAU, "id-ID": idID } satisfies Record<SupportedLocale, typeof idID>;

/**
 * Synchronous translator for the `checkpoint` namespace — see
 * `campaign-i18n.ts` (features/campaign) for why this is `createTranslator`,
 * not `getTranslations()`. Used only by the Server-Component leaves in this
 * feature (`checkpoint-progress.tsx`); the Client Component leaves
 * (`checkpoint-result.tsx`, `checkpoint-timer.tsx`,
 * `checkpoint-question-step.tsx`, `questions/*`) read the same `checkpoint`
 * namespace ambiently via `useTranslations("checkpoint")` instead.
 */
export function getCheckpointTranslator(locale: SupportedLocale) {
  return createTranslator({
    locale,
    messages: { checkpoint: CATALOGUES[locale] },
    namespace: "checkpoint",
  });
}
