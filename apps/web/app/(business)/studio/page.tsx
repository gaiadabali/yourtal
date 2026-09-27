import { redirect } from "next/navigation";
import { resolveStudioContext } from "@/features/studio/studio-context";
import { StudioChrome } from "@/features/studio/studio-chrome";
import { StudioZoneGrid } from "@/features/studio/studio-zone-grid";
import { StudioVerificationBanner } from "@/features/studio/studio-verification-banner";
import { StudioSetupChecklistCard } from "@/features/studio/studio-setup-checklist-card";
import { buildSetupChecklist, isSetupComplete } from "@/features/studio/studio-setup-checklist";
import { buildStudioNavItems } from "@/features/studio/studio-zone-items";
import { getVisibleZones } from "@/features/studio/studio-zone-access";
import { listCampaignDrafts } from "@/features/studio/campaign-builder/campaign-builder-data";
import { getBalance } from "@/features/studio/billing/billing-data";

/**
 * `/studio` overview (task 7.8.b). Sends a signed-in person with zero
 * business memberships to onboarding; otherwise shows the verification
 * banner (when unverified) and the setup checklist (until every step is
 * done), or the zone grid once set up.
 */
export default async function StudioOverviewPage(props: PageProps<"/studio">) {
  const searchParams = await props.searchParams;
  const { current, all, defaultBusinessId } = await resolveStudioContext(searchParams);

  if (!current) {
    redirect("/studio/onboarding");
  }

  const { business, myRole } = current;
  const visibleZones = myRole ? getVisibleZones(myRole, business.roles) : [];
  const navItems = buildStudioNavItems(visibleZones);
  const businessQuery = business.id === defaultBusinessId ? "" : `?business=${business.id}`;

  const [drafts, balance] = await Promise.all([
    listCampaignDrafts(business.id, business.displayName),
    getBalance(business.id),
  ]);

  const setupStatus = {
    channelSet: business.logoUrl !== null,
    pointsBought: balance.remainingPoints > 0,
    campaignUploaded: drafts.some((draft) => draft.video.status === "ready"),
    questionsWritten: drafts.some((draft) => draft.questionBank.length > 0),
    campaignSubmitted: drafts.some((draft) => draft.status !== "draft"),
  };
  const checklist = buildSetupChecklist(setupStatus);
  const kybParam = searchParams.kyb;

  return (
    <StudioChrome current={current} allMemberships={all} defaultBusinessId={defaultBusinessId}>
      <div className="flex flex-col gap-6">
        {!business.isVerified ? (
          <StudioVerificationBanner justSubmitted={kybParam === "submitted"} />
        ) : null}
        {isSetupComplete(setupStatus) ? (
          <StudioZoneGrid items={navItems} businessQuery={businessQuery} />
        ) : (
          <StudioSetupChecklistCard steps={checklist} />
        )}
      </div>
    </StudioChrome>
  );
}
