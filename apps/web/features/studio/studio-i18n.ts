import { createTranslator } from "next-intl";
import enAU from "@/messages/en-AU/studio.json";
import idID from "@/messages/id-ID/studio.json";

export type SupportedLocale = "en-AU" | "id-ID";

const CATALOGUES = { "en-AU": enAU, "id-ID": idID } satisfies Record<SupportedLocale, typeof idID>;

/**
 * Synchronous translator for the `studio` namespace — see
 * `features/checkpoint/checkpoint-i18n.ts` for why this is
 * `createTranslator`, not `getTranslations()`: several Server-Component
 * leaves under `features/studio/reports/**` and `features/studio/**` are
 * exercised directly by `render()` in Vitest/RTL, which cannot render an
 * `async` component. Defaults to `en-AU` — Studio has no locale-switch UX
 * wired up yet, so every caller renders the same catalogue until one
 * threads a real viewer locale through (mirroring `CheckpointProgress`'s
 * `locale` prop for when that lands).
 */
export function getStudioTranslator(locale: SupportedLocale = "en-AU") {
  return createTranslator({
    locale,
    messages: { studio: CATALOGUES[locale] },
    namespace: "studio",
  });
}
