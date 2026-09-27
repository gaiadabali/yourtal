import { PageHeader } from "@yourtal/ui/page-header";
import { resolveStudioContext } from "@/features/studio/studio-context";
import { StudioAccessDenied } from "@/features/studio/studio-access-denied";
import { StudioNoBusiness } from "@/features/studio/studio-no-business";
import { StudioChrome } from "@/features/studio/studio-chrome";
import { StudioZonePlaceholder } from "@/features/studio/studio-zone-placeholder";
import { canViewZone } from "@/features/studio/studio-zone-access";

/**
 * `/studio/redemptions` — zone slot only. The real screen (today's and
 * recent captures per location and device) is 8.2.g, moved out of this
 * task because it needs Phase 8's counter-device and voucher-engine APIs.
 */
export default async function StudioRedemptionsPage(props: PageProps<"/studio/redemptions">) {
  const searchParams = await props.searchParams;
  const { current, all, defaultBusinessId } = await resolveStudioContext(searchParams);

  if (!current) {
    return <StudioNoBusiness />;
  }

  const allowed = current.myRole
    ? canViewZone("redemption", current.myRole, current.business.roles)
    : false;

  return (
    <StudioChrome
      current={current}
      allMemberships={all}
      defaultBusinessId={defaultBusinessId}
      header={<PageHeader title="Redemptions" />}
    >
      {allowed ? (
        <StudioZonePlaceholder zoneLabel="Redemptions" />
      ) : (
        <StudioAccessDenied zoneLabel="Redemptions" />
      )}
    </StudioChrome>
  );
}
