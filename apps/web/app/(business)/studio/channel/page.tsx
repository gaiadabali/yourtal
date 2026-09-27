import { PageHeader } from "@yourtal/ui/page-header";
import { getLocale } from "next-intl/server";
import { resolveStudioContext } from "@/features/studio/studio-context";
import { resolveSupportedLocale } from "@/features/studio/studio-i18n";
import { StudioAccessDenied } from "@/features/studio/studio-access-denied";
import { StudioNoBusiness } from "@/features/studio/studio-no-business";
import { StudioChrome } from "@/features/studio/studio-chrome";
import { canViewZone } from "@/features/studio/studio-zone-access";
import { ChannelSettingsScreen } from "@/features/studio/channel/channel-settings-screen";

/** `/studio/channel` (task 7.8.b): logo, cover and handle. */
export default async function StudioChannelPage(props: PageProps<"/studio/channel">) {
  const searchParams = await props.searchParams;
  const { current, all, defaultBusinessId } = await resolveStudioContext(searchParams);
  const locale = resolveSupportedLocale(await getLocale());

  if (!current) {
    return <StudioNoBusiness locale={locale} />;
  }

  const allowed = current.myRole
    ? canViewZone("channel", current.myRole, current.business.roles)
    : false;

  if (!allowed) {
    return (
      <StudioChrome
        current={current}
        allMemberships={all}
        defaultBusinessId={defaultBusinessId}
        locale={locale}
      >
        <StudioAccessDenied zoneLabel="Channel settings" locale={locale} />
      </StudioChrome>
    );
  }

  const errorParam = searchParams.error;
  const errorField = typeof errorParam === "string" ? errorParam : null;

  return (
    <StudioChrome
      current={current}
      allMemberships={all}
      defaultBusinessId={defaultBusinessId}
      locale={locale}
      header={<PageHeader title="Channel settings" />}
    >
      <ChannelSettingsScreen
        business={current.business}
        saved={searchParams.saved === "1"}
        errorField={errorField}
        locale={locale}
      />
    </StudioChrome>
  );
}
