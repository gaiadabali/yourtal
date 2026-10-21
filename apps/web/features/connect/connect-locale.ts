import type { DisplayLocale } from "@yourtal/contracts/identity/user-profile";

/**
 * The app's `ui_locales` come first, in its order. Only the two languages
 * YourTal ships are honoured; `en`, `en-US` and the like map to en-AU, and
 * `id` to id-ID. With none of those, the person's own language stands.
 */
export function pickConnectLocale(
  uiLocales: readonly string[],
  personsLocale: DisplayLocale,
): DisplayLocale {
  for (const tag of uiLocales) {
    const language = tag.trim().toLowerCase().split(/[-_]/)[0];
    if (language === "id") return "id-ID";
    if (language === "en") return "en-AU";
  }
  return personsLocale;
}
