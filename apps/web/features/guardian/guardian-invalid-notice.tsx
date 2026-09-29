import { Text } from "@yourtal/ui/text";
import { getGuardianTranslator } from "./guardian-i18n";

/**
 * The unknown/invalid-token state (12.2.c), rendered by
 * `app/(guardian)/guardian/[token]/not-found.tsx` via `notFound()`. No
 * locale is known for a token that matches nothing, so — same call
 * `public-not-found.tsx` makes for the same reason — this speaks the
 * default locale (en-AU) only.
 */
export function GuardianInvalidNotice() {
  const t = getGuardianTranslator("en-AU");
  return <Text tone="muted">{t("invalid.body")}</Text>;
}
