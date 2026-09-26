import { getTranslations } from "next-intl/server";
import type { UserProfile } from "@yourtal/contracts/identity/user-profile";
import { Section } from "@yourtal/ui/section";
import { Input } from "@yourtal/ui/input";
import { Button } from "@yourtal/ui/button";
import { Text } from "@yourtal/ui/text";
import { updateMeAction } from "@/lib/api/actions";

export interface MeProfileSectionProps {
  profile: UserProfile;
}

/**
 * Display name only — `region` is immutable (1.4.a/1.4.d: "never region,
 * which is immutable"), shown as plain text, not a field, so nothing here
 * implies it could be submitted. Submits to Area A's `updateMeAction`
 * (same zero-client-JS `<form>` as `MeLanguageSection`).
 */
export async function MeProfileSection({ profile }: MeProfileSectionProps) {
  const t = await getTranslations("me.profile");

  return (
    <Section title={t("heading")}>
      <form action={updateMeAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        {/* eslint-disable-next-line yt-b/prefer-primitives -- a hidden field, no copy or interaction to wrap */}
        <input type="hidden" name="returnTo" value="/me" />
        <div className="flex-1">
          <Input
            label={t("displayNameLabel")}
            name="displayName"
            defaultValue={profile.displayName}
            maxLength={120}
            required
          />
        </div>
        <Button type="submit">{t("saveCta")}</Button>
      </form>
      <Text size="body-sm" tone="muted">
        {t("regionLabel")}: {profile.region}
      </Text>
    </Section>
  );
}
