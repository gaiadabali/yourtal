import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { PageHeader } from "@yourtal/ui/page-header";
import { resolveStudioContext } from "@/features/studio/studio-context";
import { resolveSupportedLocale } from "@/features/studio/studio-i18n";
import { StudioChrome } from "@/features/studio/studio-chrome";
import { StudioZoneGrid } from "@/features/studio/studio-zone-grid";
import { StudioVerificationBanner } from "@/features/studio/studio-verification-banner";
import { StudioSetupChecklistCard } from "@/features/studio/studio-setup-checklist-card";
import { buildSetupChecklist, isSetupComplete } from "@/features/studio/studio-setup-checklist";
import { buildStudioNavItems } from "@/features/studio/studio-zone-items";
import { getVisibleZones } from "@/features/studio/studio-zone-access";
import { listCampaignDrafts } from "@/features/studio/campaign-builder/campaign-builder-data";
import { getBalance } from "@/features/studio/billing/billing-data";
import { listKybDocuments } from "@/features/studio/onboarding/kyb-data";

/**
 * `/studio` overview (task 7.8.b). Sends a signed-in person with zero
 * business memberships to onboarding; otherwise shows the verification
 * banner (when unverified) and the setup checklist (until every step is
 * done), or the zone grid once set up.
 */
export default async function StudioOverviewPage(props: PageProps<"/studio">) {
  const searchParams = await props.searchParams;
  const { current, all, defaultBusinessId } = await resolveStudioContext(searchParams);
  const locale = resolveSupportedLocale(await getLocale());

  if (!current) {
    redirect("/studio/onboarding");
  }

  const { business, myRole } = current;
  const visibleZones = myRole ? getVisibleZones(myRole, business.roles) : [];
  const navItems = buildStudioNavItems(visibleZones);
  const businessQuery = business.id === defaultBusinessId ? "" : `?business=${business.id}`;

  const [drafts, balance, kybDocuments] = await Promise.all([
    listCampaignDrafts(business.id, business.displayName),
    // Billing is owner/admin/finance only; anyone else still gets an overview.
    getBalance(business.id).catch(() => null),
    business.isVerified ? Promise.resolve([]) : listKybDocuments(business.id),
  ]);

  const setupStatus = {
    channelSet: business.logoUrl !== null,
    // Not this person's step when they cannot see billing (left off their list below).
    pointsBought: balance === null || balance.remainingPoints > 0,
    campaignUploaded: drafts.some((draft) => draft.video.status === "ready"),
    questionsWritten: drafts.some((draft) => draft.questionBank.length > 0),
    campaignSubmitted: drafts.some((draft) => draft.status !== "draft"),
  };
  const checklist = buildSetupChecklist(setupStatus).filter(
    (step) => step.id !== "pointsBought" || balance !== null,
  );

  return (
    <StudioChrome
      current={current}
      allMemberships={all}
      defaultBusinessId={defaultBusinessId}
      locale={locale}
      // A fixed, short label — never the business's own (arbitrary-length,
      // user-supplied) display name: `StudioShell`'s header row is a fixed
      // 56px strip, and a long name wrapping to multiple lines there
      // overflows into the content below it. The name is already shown in
      // the sidebar identity panel, so nothing is lost by not repeating it
      // here too.
      header={<PageHeader title="Overview" />}
    >
      <div className="flex flex-col gap-6">
        {!business.isVerified ? (
          <StudioVerificationBanner
            businessId={business.id}
            underReview={kybDocuments.some((doc) => doc.status === "submitted")}
            locale={locale}
          />
        ) : null}
        {isSetupComplete(setupStatus) ? (
          <StudioZoneGrid items={navItems} businessQuery={businessQuery} />
        ) : (
          <StudioSetupChecklistCard steps={checklist} locale={locale} />
        )}
      </div>
    </StudioChrome>
  );
}
