import { Badge } from "@yourtal/ui/badge";
import type { CampaignDraftStatus } from "./campaign-draft-status";
import {
  CAMPAIGN_DRAFT_STATUS_BADGE_VARIANT,
  CAMPAIGN_DRAFT_STATUS_LABELS,
} from "./campaign-draft-status";

export interface CampaignDraftStatusBadgeProps {
  status: CampaignDraftStatus;
}

export function CampaignDraftStatusBadge({ status }: CampaignDraftStatusBadgeProps) {
  return (
    <Badge variant={CAMPAIGN_DRAFT_STATUS_BADGE_VARIANT[status]}>
      {CAMPAIGN_DRAFT_STATUS_LABELS[status]}
    </Badge>
  );
}
