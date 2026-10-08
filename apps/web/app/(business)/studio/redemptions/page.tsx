import { getLocale } from "next-intl/server";
import { PageHeader } from "@yourtal/ui/page-header";
import { resolveStudioContext } from "@/features/studio/studio-context";
import {
  getStudioTranslator,
  resolveSupportedLocale,
  type SupportedLocale,
} from "@/features/studio/studio-i18n";
import { StudioAccessDenied } from "@/features/studio/studio-access-denied";
import { StudioNoBusiness } from "@/features/studio/studio-no-business";
import { StudioChrome } from "@/features/studio/studio-chrome";
import { canViewZone } from "@/features/studio/studio-zone-access";
import { listRedemptionsLive } from "@/features/studio/redemptions-data";
import { RedemptionsScreen } from "@/features/studio/redemptions-screen";

/**
 * `/studio/redemptions` (TASKS.md 8.2.g). Gated the same as Team (owner,
 * admin) — `studio-redemptions.controller.ts`'s own `@Authorize({kind:
 * "team", action: "view"})`.
 */
export default async function StudioRedemptionsPage(props: PageProps<"/studio/redemptions">) {
  const searchParams = await props.searchParams;
  const { current, all, defaultBusinessId } = await resolveStudioContext(searchParams);
  const locale = resolveSupportedLocale(await getLocale());
  const t = getStudioTranslator(locale);

  if (!current) {
    return <StudioNoBusiness locale={locale} />;
  }

  const allowed = current.myRole
    ? canViewZone("redemptions", current.myRole, current.business.roles)
    : false;

  return (
    <StudioChrome
      current={current}
      allMemberships={all}
      defaultBusinessId={defaultBusinessId}
      locale={locale}
      header={<PageHeader title={t("zones.redemptions")} />}
    >
      {allowed ? (
        <StudioRedemptionsData businessId={current.business.id} locale={locale} />
      ) : (
        <StudioAccessDenied zoneLabel={t("zones.redemptions")} locale={locale} />
      )}
    </StudioChrome>
  );
}

async function StudioRedemptionsData({
  businessId,
  locale,
}: {
  businessId: string;
  locale: SupportedLocale;
}) {
  const result = await listRedemptionsLive(businessId);
  return <RedemptionsScreen entries={result.ok ? result.data.entries : []} locale={locale} />;
}
