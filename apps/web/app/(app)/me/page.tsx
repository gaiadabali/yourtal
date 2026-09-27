import { getTranslations } from "next-intl/server";
import { PageContainer } from "@yourtal/ui/page-container";
import { PageHeader } from "@yourtal/ui/page-header";
import { Button } from "@yourtal/ui/button";
import {
  getAutoplaySetting,
  getMeProfile,
  getNotificationPreferences,
  listConsents,
  listFollows,
  listInterests,
} from "@/features/me/me-data";
import { logoutAction } from "@/lib/api/actions";
import { MeProfileSection } from "@/features/me/me-profile-section";
import { MeLanguageSection } from "@/features/me/me-language-section";
import { MeAutoplaySection } from "@/features/me/me-autoplay-section";
import { MeInterestsSection } from "@/features/me/me-interests-section";
import { MeFollowsSection } from "@/features/me/me-follows-section";
import { MeConsentSection } from "@/features/me/me-consent-section";
import { MeSecuritySection } from "@/features/me/me-security-section";
import { MeNotificationsSection } from "@/features/me/me-notifications-section";
import { MeLinkedAppsSection } from "@/features/me/me-linked-apps-section";
import { MeDataExportSection } from "@/features/me/me-data-export-section";
import { MeDeleteAccountSection } from "@/features/me/me-delete-account-section";
import { MeSectionError } from "@/features/me/me-section-states";

/**
 * `/me` (TASKS.md 6.7.a), replacing the Phase U placeholder wholesale — see
 * this ticket's report for why nothing of the old file survives. A Server
 * Component per docs/13b section 8: every read below is a real `apiFetch`
 * round trip run in parallel (`apiFetch` never throws — a failed call is
 * an `ApiResult.error`, not a rejection — so a plain `Promise.all` is
 * enough), and each section gets its OWN `ApiResult` rather than one
 * `Promise.all().catch()` for the whole page, so one dead endpoint
 * degrades only its own section (`MeSectionError`) instead of blanking
 * every other control on the page.
 *
 * Password change, delete-account and log out do not depend on any of
 * these reads, so they render unconditionally.
 */
export default async function MePage() {
  const t = await getTranslations("me");
  const [profile, consents, interests, follows, notificationPreferences, autoplay] =
    await Promise.all([
      getMeProfile(),
      listConsents(),
      listInterests(),
      listFollows(),
      getNotificationPreferences(),
      getAutoplaySetting(),
    ]);

  return (
    <PageContainer width="narrow">
      <div className="flex flex-col gap-8 py-6">
        <PageHeader
          title={t("page.heading")}
          description={t("page.intro")}
          actions={
            <form action={logoutAction}>
              <Button type="submit" variant="secondary">
                {t("logout.cta")}
              </Button>
            </form>
          }
        />

        {profile.ok ? (
          <>
            <MeProfileSection profile={profile.data.profile} />
            <MeLanguageSection displayLocale={profile.data.profile.displayLocale} />
          </>
        ) : (
          <MeSectionError title={t("profile.heading")} error={profile.error} />
        )}

        {autoplay.ok ? (
          <MeAutoplaySection initialAutoplay={autoplay.data.autoplay} />
        ) : (
          <MeSectionError title={t("autoplay.heading")} error={autoplay.error} />
        )}

        {interests.ok ? (
          <MeInterestsSection initialNodeIds={interests.data.nodeIds} />
        ) : (
          <MeSectionError title={t("interests.heading")} error={interests.error} />
        )}

        {follows.ok ? (
          <MeFollowsSection initialFollows={follows.data.follows} />
        ) : (
          <MeSectionError title={t("follows.heading")} error={follows.error} />
        )}

        {consents.ok ? (
          <MeConsentSection initialConsents={consents.data.consents} />
        ) : (
          <MeSectionError title={t("consent.heading")} error={consents.error} />
        )}

        <MeSecuritySection />

        {notificationPreferences.ok ? (
          <MeNotificationsSection initialPreferences={notificationPreferences.data.preferences} />
        ) : (
          <MeSectionError
            title={t("notifications.heading")}
            error={notificationPreferences.error}
          />
        )}

        <MeLinkedAppsSection />
        <MeDataExportSection />
        <MeDeleteAccountSection />
      </div>
    </PageContainer>
  );
}
