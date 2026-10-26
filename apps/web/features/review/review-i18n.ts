import type { DisplayLocale } from "@yourtal/contracts/identity/user-profile";
import { makeSyncTranslator } from "@/i18n/sync-translator";
import enAU from "@/messages/en-AU/review.json";
import idID from "@/messages/id-ID/review.json";

/** The reviewer's guide can be read in either language whatever the viewer's own setting is. */
export const getReviewTranslator = makeSyncTranslator("review", { "en-AU": enAU, "id-ID": idID });

/** `?lang=id` / `?lang=en` picks the guide's language; anything else leaves it to the caller's default. */
export function reviewLocaleFromParam(
  value: string | string[] | undefined,
): DisplayLocale | undefined {
  const lang = Array.isArray(value) ? value[0] : value;
  if (lang === "id") return "id-ID";
  if (lang === "en") return "en-AU";
  return undefined;
}
