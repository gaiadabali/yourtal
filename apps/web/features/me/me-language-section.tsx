import { getTranslations } from "next-intl/server";
import type { DisplayLocale } from "@yourtal/contracts/identity/user-profile";
import { Section } from "@yourtal/ui/section";
import { NativeSelect } from "@yourtal/ui/native-select";
import { Button } from "@yourtal/ui/button";
import { updateMeAction } from "@/lib/api/actions";

export interface MeLanguageSectionProps {
  displayLocale: DisplayLocale;
}

/**
 * 6.1.b's Me half: display language, independent of region. Submits
 * straight to Area A's `updateMeAction` (`PATCH /api/me` +
 * `yt_locale` cookie, `lib/api/actions.ts` — not edited here, only
 * imported), the same zero-client-JS `<form action={...}>` shape
 * `commitRegionAction` already uses. A full page reload is the right
 * outcome here, not a shortcoming: every server-rendered string on the
 * page depends on the locale the request resolved, so the whole tree has
 * to re-render under the new one regardless of mechanism.
 */
export async function MeLanguageSection({ displayLocale }: MeLanguageSectionProps) {
  const t = await getTranslations("me.language");

  return (
    <Section title={t("heading")} description={t("intro")}>
      <form action={updateMeAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        {/* A hidden field carries no user-facing copy or interaction for a
            primitive to wrap — same as commit-region-action.ts's own form. */}
        {/* eslint-disable-next-line yt-b/prefer-primitives */}
        <input type="hidden" name="returnTo" value="/me" />
        <div className="flex-1">
          <NativeSelect
            label={t("heading")}
            hideLabel
            name="displayLocale"
            defaultValue={displayLocale}
          >
            <option value="en-AU">{t("labelEnAU")}</option>
            <option value="id-ID">{t("labelIdID")}</option>
          </NativeSelect>
        </div>
        <Button type="submit">{t("saveCta")}</Button>
      </form>
    </Section>
  );
}
