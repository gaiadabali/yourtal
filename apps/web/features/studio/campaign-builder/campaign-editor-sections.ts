export const CAMPAIGN_EDITOR_SECTIONS = [
  "details",
  "video",
  "reward",
  "targeting",
  "budget",
  "questions",
] as const;
export type CampaignEditorSection = (typeof CAMPAIGN_EDITOR_SECTIONS)[number];
