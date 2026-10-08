import { getLocale } from "next-intl/server";
import { PageHeader } from "@yourtal/ui/page-header";
import { resolveStudioContext } from "@/features/studio/studio-context";
import { getStudioTranslator, resolveSupportedLocale } from "@/features/studio/studio-i18n";
import { StudioAccessDenied } from "@/features/studio/studio-access-denied";
import { StudioNoBusiness } from "@/features/studio/studio-no-business";
import { StudioChrome } from "@/features/studio/studio-chrome";
import { canViewZone } from "@/features/studio/studio-zone-access";
import { getWebhookLive, listCredentialsLive } from "@/features/studio/developer-credentials-data";
import { DeveloperCredentialsScreen } from "@/features/studio/developer-credentials-screen";
import { PUBLIC_SITE_URL } from "@/features/public/public-locale";
import { DeveloperDocsPanel } from "@/features/studio/developer-docs-panel";

/**
 * `/studio/developers` (TASKS.md 8.3.a). Issue/rotate/revoke merchant HMAC
 * credentials, register the webhook delivery URL (8.3.c), and the
 * integration docs — gated the same as Team (owner, admin).
 */
export default async function StudioDevelopersPage(props: PageProps<"/studio/developers">) {
  const searchParams = await props.searchParams;
  const { current, all, defaultBusinessId } = await resolveStudioContext(searchParams);
  const locale = resolveSupportedLocale(await getLocale());
  const t = getStudioTranslator(locale);

  if (!current) {
    return <StudioNoBusiness locale={locale} />;
  }

  const allowed = current.myRole
    ? canViewZone("developers", current.myRole, current.business.roles)
    : false;

  return (
    <StudioChrome
      current={current}
      allMemberships={all}
      defaultBusinessId={defaultBusinessId}
      locale={locale}
      header={<PageHeader title={t("zones.developers")} />}
    >
      {allowed ? (
        <div className="flex flex-col gap-6">
          <StudioDevelopersData businessId={current.business.id} />
          <DeveloperDocsPanel baseUrl={`${PUBLIC_SITE_URL}/v1/vouchers`} />
        </div>
      ) : (
        <StudioAccessDenied zoneLabel={t("zones.developers")} locale={locale} />
      )}
    </StudioChrome>
  );
}

async function StudioDevelopersData({ businessId }: { businessId: string }) {
  const [credentials, webhook] = await Promise.all([
    listCredentialsLive(businessId),
    getWebhookLive(businessId),
  ]);
  return (
    <DeveloperCredentialsScreen
      businessId={businessId}
      initialCredentials={credentials.ok ? credentials.data : []}
      initialWebhook={webhook.ok ? webhook.data : null}
    />
  );
}
