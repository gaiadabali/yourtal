import { PageHeader } from "@yourtal/ui/page-header";
import { resolveStudioContext } from "@/features/studio/studio-context";
import { StudioAccessDenied } from "@/features/studio/studio-access-denied";
import { StudioNoBusiness } from "@/features/studio/studio-no-business";
import { StudioChrome } from "@/features/studio/studio-chrome";
import { canEditZone, canViewZone } from "@/features/studio/studio-zone-access";
import {
  PRESET_POINT_AMOUNTS,
  getBalance,
  listPurchases,
  quotePoints,
} from "@/features/studio/billing/billing-data";
import { BillingScreen } from "@/features/studio/billing/billing-screen";

/** `/studio/billing` (task 7.5 / 7.8.b): real quotes, a real purchase, real balance. */
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

  const { id: businessId, currency } = current.business;
  const [balance, quotes, purchases] = await Promise.all([
    getBalance(businessId),
    Promise.all(PRESET_POINT_AMOUNTS.map((points) => quotePoints(businessId, points, currency))),
    listPurchases(businessId),
  ]);
  // Minted once per render, not per submit — see `billing-screen.tsx`'s doc comment.
  const idempotencyKey = crypto.randomUUID();

  return (
    <StudioChrome
      current={current}
      allMemberships={all}
      defaultBusinessId={defaultBusinessId}
      header={<PageHeader title="Billing" />}
    >
      <BillingScreen
        businessId={businessId}
        balance={balance}
        quotes={quotes}
        purchases={purchases}
        canPurchase={canPurchase}
        idempotencyKey={idempotencyKey}
      />
    </StudioChrome>
  );
}
