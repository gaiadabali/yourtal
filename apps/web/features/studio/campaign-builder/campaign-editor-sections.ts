export const CAMPAIGN_EDITOR_SECTIONS = [
  "details",
  "video",
  "reward",
  "targeting",
  "budget",
  "questions",
  "boost",
] as const;
export type CampaignEditorSection = (typeof CAMPAIGN_EDITOR_SECTIONS)[number];
