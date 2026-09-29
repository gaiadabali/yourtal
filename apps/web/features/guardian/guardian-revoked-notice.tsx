import { Text } from "@yourtal/ui/text";
import { getGuardianTranslator, type GuardianLocale } from "./guardian-i18n";

export interface GuardianRevokedNoticeProps {
  displayName: string;
  locale: GuardianLocale;
}

/** The `revoked` state (12.2.c): final — "nothing further can be done with this link." No action, no button. */
export function GuardianRevokedNotice({ displayName, locale }: GuardianRevokedNoticeProps) {
  const t = getGuardianTranslator(locale);
  return <Text tone="muted">{t("revoked.body", { displayName })}</Text>;
}
