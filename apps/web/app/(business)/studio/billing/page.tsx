import { PageHeader } from "@yourtal/ui/page-header";
import { resolveStudioContext } from "@/features/studio/studio-context";
import { StudioAccessDenied } from "@/features/studio/studio-access-denied";
import { StudioNoBusiness } from "@/features/studio/studio-no-business";
import { StudioChrome } from "@/features/studio/studio-chrome";
import { canEditZone, canViewZone } from "@/features/studio/studio-zone-access";
import { getBalance, listPacks, listPurchases } from "@/features/studio/billing/billing-data";
import { BillingScreen } from "@/features/studio/billing/billing-screen";

/** `/studio/billing` (task 7.5 / 7.8.b): pack prices, a simulated purchase, balance and purchase history. */
export default async function StudioBillingPage(props: PageProps<"/studio/billing">) {
  const searchParams = await props.searchParams;
  const { current, all, defaultBusinessId } = await resolveStudioContext(searchParams);

  if (!current) {
    return <StudioNoBusiness />;
  }

  const allowed = current.myRole
    ? canViewZone("billing", current.myRole, current.business.roles)
    : false;
  const canPurchase = current.myRole
    ? canEditZone("billing", current.myRole, current.business.roles)
    : false;

  if (!allowed) {
    return (
      <StudioChrome current={current} allMemberships={all} defaultBusinessId={defaultBusinessId}>
        <StudioAccessDenied zoneLabel="Billing" />
      </StudioChrome>
    );
  }

  const { currency } = current.business;
  const [balance, packs, purchases] = await Promise.all([
    getBalance(current.business.id, currency),
    listPacks(currency),
    listPurchases(current.business.id),
  ]);

  return (
    <StudioChrome
      current={current}
      allMemberships={all}
      defaultBusinessId={defaultBusinessId}
      header={<PageHeader title="Billing" />}
    >
      <BillingScreen
        businessId={current.business.id}
        balance={balance}
        packs={packs}
        purchases={purchases}
        canPurchase={canPurchase}
      />
    </StudioChrome>
  );
}
