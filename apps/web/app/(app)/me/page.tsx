import { getTranslations } from "next-intl/server";
import { PageContainer } from "@yourtal/ui/page-container";
import { PageHeader } from "@yourtal/ui/page-header";
import {
  getAutoplaySetting,
  getMeProfile,
  getViewerArea,
  getNotificationPreferences,
  getSignInMethods,
  listConsents,
  listFollows,
  listInterests,
  listLinkedApps,
} from "@/features/me/me-data";
import { earnedToday, getWalletBalance } from "@/features/wallet/wallet-data";
import { LogoutButton } from "@/features/me/logout-button";
import { MeProfileSection } from "@/features/me/me-profile-section";
import { MeLanguageSection } from "@/features/me/me-language-section";
import { MeAutoplaySection } from "@/features/me/me-autoplay-section";
import { MeAreaSection } from "@/features/me/me-area-section";
import { MeThemeSection } from "@/features/me/me-theme-section";
import { readThemeCookie } from "@/lib/api/session-cookies";
import { MeInterestsSection } from "@/features/me/me-interests-section";
import { MeFollowsSection } from "@/features/me/me-follows-section";
import { MeConsentSection } from "@/features/me/me-consent-section";
import { MeSecuritySection } from "@/features/me/me-security-section";
import { MePasskeysSection } from "@/features/me/me-passkeys-section";
import { MeAuthenticatorSection } from "@/features/me/me-authenticator-section";
import { MeNotificationsSection } from "@/features/me/me-notifications-section";
import { MeLinkedAppsSection } from "@/features/me/me-linked-apps-section";
import { MeDataExportSection } from "@/features/me/me-data-export-section";
import { MeDeleteAccountSection } from "@/features/me/me-delete-account-section";
import { MeTeenCapSection } from "@/features/me/me-teen-cap-section";
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
  const [
    profile,
    consents,
    interests,
    follows,
    notificationPreferences,
    autoplay,
    linkedApps,
    signInMethods,
  ] = await Promise.all([
    getMeProfile(),
    listConsents(),
    listInterests(),
    listFollows(),
    getNotificationPreferences(),
    getAutoplaySetting(),
    listLinkedApps(),
    getSignInMethods(),
  ]);

  // 12.2.b: the teen daily-cap meter is its own, teen-only read -- most
  // viewers are adults and never pay for this round trip at all.
  const isTeen = profile.ok && profile.data.profile.ageBand === "teen";
  // F116: "my area" is for adults. A teen never sees it (nor is it fetched: the API
  // refuses one), and neither does anyone whose age band could not be read.
  const isAdult = profile.ok && profile.data.profile.ageBand === "adult";
  const area = isAdult ? await getViewerArea() : null;
  const [wallet, todayPoints] = isTeen
    ? await Promise.all([getWalletBalance(), earnedToday(profile.data.profile.region)])
    : [null, 0];

  return (
    <PageContainer width="narrow">
      <div className="flex flex-col gap-8 py-6">
        <PageHeader
          title={t("page.heading")}
          description={t("page.intro")}
          actions={<LogoutButton label={t("logout.cta")} />}
        />

        {profile.ok ? (
          <>
            <MeProfileSection profile={profile.data.profile} />
            <MeLanguageSection displayLocale={profile.data.profile.displayLocale} />
          </>
        ) : (
          <MeSectionError title={t("profile.heading")} error={profile.error} />
        )}

        <MeThemeSection initialTheme={await readThemeCookie()} />
        {autoplay.ok ? (
          <MeAutoplaySection initialAutoplay={autoplay.data.autoplay} />
        ) : (
          <MeSectionError title={t("autoplay.heading")} error={autoplay.error} />
        )}

        {area === null ? null : area.ok ? (
          <MeAreaSection initialArea={area.data.area} />
        ) : (
          <MeSectionError title={t("area.heading")} error={area.error} />
        )}

        {isTeen && wallet?.ok === true && wallet.data.dailyCapPoints !== undefined ? (
          <MeTeenCapSection
            earnedTodayPoints={todayPoints}
            dailyCapPoints={wallet.data.dailyCapPoints}
          />
        ) : null}

        {interests.ok ? (
          <MeInterestsSection
            initialNodeIds={interests.data.nodeIds}
            ageBand={profile.ok ? profile.data.profile.ageBand : "adult"}
          />
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
        {signInMethods.ok ? (
          <>
            <MePasskeysSection initialPasskeys={signInMethods.data.passkeys} />
            <MeAuthenticatorSection
              enabled={signInMethods.data.authenticatorApp.enabled}
              hasPasskeys={signInMethods.data.passkeys.length > 0}
            />
          </>
        ) : (
          <MeSectionError title={t("signInMethods.heading")} error={signInMethods.error} />
        )}

        {notificationPreferences.ok ? (
          <MeNotificationsSection initialPreferences={notificationPreferences.data.preferences} />
        ) : (
          <MeSectionError
            title={t("notifications.heading")}
            error={notificationPreferences.error}
          />
        )}

        {linkedApps.ok ? (
          <MeLinkedAppsSection initialLinkedApps={linkedApps.data.linkedApps} isTeen={isTeen} />
        ) : (
          <MeSectionError title={t("linkedApps.heading")} error={linkedApps.error} />
        )}
        <MeDataExportSection />
        <MeDeleteAccountSection />
      </div>
    </PageContainer>
  );
}
