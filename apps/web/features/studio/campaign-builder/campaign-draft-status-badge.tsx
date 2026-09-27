import { useTranslations } from "next-intl";
import { Badge } from "@yourtal/ui/badge";
import type { CampaignDraftStatus } from "./campaign-draft-status";
import {
  CAMPAIGN_DRAFT_STATUS_BADGE_VARIANT,
  campaignDraftStatusLabel,
} from "./campaign-draft-status";

export interface CampaignDraftStatusBadgeProps {
  status: CampaignDraftStatus;
}

export function CampaignDraftStatusBadge({ status }: CampaignDraftStatusBadgeProps) {
  const t = useTranslations("studio");
  return (
    <Badge variant={CAMPAIGN_DRAFT_STATUS_BADGE_VARIANT[status]}>
      {campaignDraftStatusLabel(t, status)}
    </Badge>
  );
}
