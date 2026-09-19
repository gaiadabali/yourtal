export const CAMPAIGN_EDITOR_SECTIONS = [
  "details",
  "video",
  "reward",
  "targeting",
  "budget",
  "questions",
] as const;
export type CampaignEditorSection = (typeof CAMPAIGN_EDITOR_SECTIONS)[number];

export const CAMPAIGN_EDITOR_SECTION_LABELS: Record<CampaignEditorSection, string> = {
  details: "Details",
  video: "Video & chapters",
  reward: "Reward",
  targeting: "Targeting",
  budget: "Budget",
  questions: "Questions",
};
