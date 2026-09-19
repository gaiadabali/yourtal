import type { Campaign } from "@yourtal/contracts/campaign";
import { CampaignCard } from "./campaign-card";

export interface CampaignGridProps {
  campaigns: readonly Campaign[];
}

/**
 * The dense card grid itself (YT-0410, docs/17-surfaces-and-roles.md §1:
 * "Shopee home — dense grid of cards"). Two columns on a phone, widening on
 * larger viewports per §1.1 ("Tablet and desktop widen the layout — more
 * columns ... not a different product").
 */
export function CampaignGrid({ campaigns }: CampaignGridProps) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {campaigns.map((campaign) => (
        <li key={campaign.id} className="min-w-0">
          <CampaignCard campaign={campaign} />
        </li>
      ))}
    </ul>
  );
}
