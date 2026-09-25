import { Suspense } from "react";

import { CampaignBoardControls } from "@/features/campaign/campaign-board-controls";
import { getCampaignBoardLabels } from "@/features/campaign/campaign-board-labels";
import { parseCampaignBoardParams } from "@/features/campaign/campaign-board-params";
import { listCampaigns } from "@/features/campaign/campaign-data";
import { CampaignEmptyState } from "@/features/campaign/campaign-empty-state";
import { filterCampaignsByKind } from "@/features/campaign/campaign-filter";
import { CampaignGrid } from "@/features/campaign/campaign-grid";
import { CampaignGridSkeleton } from "@/features/campaign/campaign-grid-skeleton";
import { sortCampaigns } from "@/features/campaign/campaign-sort";
import { StreakCheckInCard } from "@/features/streak/streak-check-in-card";
import { getRegionDisplayConfig } from "@/features/region/get-region";

/**
 * The Earn board (YT-0410) — `/`, the app's home surface.
 * docs/17-surfaces-and-roles.md §1: "Shopee home — dense grid of cards ...
 * sorted by expected value to *this* user." Server Component per
 * docs/13b-typescript-standards.md §8: this file carries no `"use client"`
 * directive; the only interactive piece is `CampaignBoardControls`, a leaf.
 */
export default async function EarnBoardPage(props: PageProps<"/">) {
  const searchParams = await props.searchParams;
  const { sort, kind } = parseCampaignBoardParams(searchParams);
  const { locale } = await getRegionDisplayConfig();
  const labels = getCampaignBoardLabels(locale);

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold text-fg">{labels.title}</h1>
      <StreakCheckInCard />
      <CampaignBoardControls labels={labels} />
      {/* Board-specific fallback lives here, not in the group's loading.tsx,
          which is shared with every sibling tab. */}
      <Suspense fallback={<CampaignGridSkeleton />}>
        <CampaignBoard sort={sort} kind={kind} />
      </Suspense>
    </div>
  );
}

interface CampaignBoardProps {
  sort: ReturnType<typeof parseCampaignBoardParams>["sort"];
  kind: ReturnType<typeof parseCampaignBoardParams>["kind"];
}

async function CampaignBoard({ sort, kind }: CampaignBoardProps) {
  const [campaigns, { locale }] = await Promise.all([listCampaigns(), getRegionDisplayConfig()]);
  const visibleCampaigns = sortCampaigns(filterCampaignsByKind(campaigns, kind), sort);

  return visibleCampaigns.length === 0 ? (
    <CampaignEmptyState kind={kind} locale={locale} />
  ) : (
    <CampaignGrid campaigns={visibleCampaigns} locale={locale} />
  );
}
