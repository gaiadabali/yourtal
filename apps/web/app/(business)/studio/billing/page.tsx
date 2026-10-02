import { BoostChargesCard } from "@/features/studio/boost/boost-sections";
import { Notice } from "@yourtal/ui/notice";
import { PageHeader } from "@yourtal/ui/page-header";
import { getLocale } from "next-intl/server";
import { resolveStudioContext } from "@/features/studio/studio-context";
import { getStudioTranslator, resolveSupportedLocale } from "@/features/studio/studio-i18n";
import { StudioAccessDenied } from "@/features/studio/studio-access-denied";
import { StudioNoBusiness } from "@/features/studio/studio-no-business";
import { StudioChrome } from "@/features/studio/studio-chrome";
import { canEditZone, canViewZone } from "@/features/studio/studio-zone-access";
import {
  PRESET_POINT_AMOUNTS,
  getBalance,
  quotePoints,
} from "@/features/studio/billing/billing-data";
import { BillingScreen } from "@/features/studio/billing/billing-screen";

/** `/studio/billing` (task 7.5 / 7.8.b): real quotes, a real purchase, real balance. */
export default async function StudioBillingPage(props: PageProps<"/studio/billing">) {
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
  const canPurchase = current.myRole
    ? canEditZone("billing", current.myRole, current.business.roles)
    : false;

  if (!allowed) {
    return (
      <StudioChrome
        current={current}
        allMemberships={all}
        defaultBusinessId={defaultBusinessId}
        locale={locale}
      >
        <StudioAccessDenied zoneLabel="Billing" locale={locale} />
      </StudioChrome>
    );
  }

  const { id: businessId, currency } = current.business;
  const [balance, quotes] = await Promise.all([
    getBalance(businessId),
    Promise.all(PRESET_POINT_AMOUNTS.map((points) => quotePoints(businessId, points, currency))),
  ]);
  // Minted once per render, not per submit — see `billing-screen.tsx`'s doc comment.
  const idempotencyKey = crypto.randomUUID();

  return (
    <StudioChrome
      current={current}
      allMemberships={all}
      defaultBusinessId={defaultBusinessId}
      locale={locale}
      header={<PageHeader title="Billing" />}
    >
      <div className="flex flex-col gap-6">
        {searchParams.purchased === "1" ? (
          <Notice tone="success">{t("billing.purchased")}</Notice>
        ) : null}
        {typeof searchParams.error === "string" ? (
          <Notice tone="danger">{t("billing.purchaseFailed")}</Notice>
        ) : null}
        <BillingScreen
          businessId={businessId}
          balance={balance}
          quotes={quotes}
          canPurchase={canPurchase}
          idempotencyKey={idempotencyKey}
          locale={locale}
        />
        <BoostChargesCard businessId={businessId} locale={locale} />
      </div>
    </StudioChrome>
  );
}
