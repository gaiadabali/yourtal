import { getLocale } from "next-intl/server";
import type { Region } from "@yourtal/contracts/region";
import { Notice } from "@yourtal/ui/notice";
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
import { listInvoices } from "@/features/studio/invoices/invoices-data";
import { InvoicesScreen } from "@/features/studio/invoices/invoices-screen";

/**
 * `/studio/billing/invoices` (5.3 / 14.9). Same gate as Billing (owner, admin,
 * finance): the API's `billing` `view`.
 */
export default async function StudioInvoicesPage(props: PageProps<"/studio/billing/invoices">) {
  const searchParams = await props.searchParams;
  const { current, all, defaultBusinessId } = await resolveStudioContext(searchParams);
  const locale = resolveSupportedLocale(await getLocale());
  const t = getStudioTranslator(locale);

  if (!current) {
    return <StudioNoBusiness locale={locale} />;
  }

  const allowed = current.myRole
    ? canViewZone("billing", current.myRole, current.business.roles)
    : false;

  return (
    <StudioChrome
      current={current}
      allMemberships={all}
      defaultBusinessId={defaultBusinessId}
      locale={locale}
      header={<PageHeader title={t("zones.invoices")} />}
    >
      {allowed ? (
        <StudioInvoicesData
          businessId={current.business.id}
          region={current.business.region}
          locale={locale}
        />
      ) : (
        <StudioAccessDenied zoneLabel={t("zones.invoices")} locale={locale} />
      )}
    </StudioChrome>
  );
}

async function StudioInvoicesData({
  businessId,
  region,
  locale,
}: {
  businessId: string;
  region: Region;
  locale: SupportedLocale;
}) {
  const result = await listInvoices(businessId);
  if (!result.ok) {
    return <Notice tone="danger">{getStudioTranslator(locale)("invoices.loadFailed")}</Notice>;
  }
  return (
    <InvoicesScreen
      businessId={businessId}
      invoices={result.data.invoices}
      locale={locale}
      region={region}
    />
  );
}
