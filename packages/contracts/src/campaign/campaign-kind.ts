// 13.4.d: zod-free, so client components can import these without pulling zod.
export const CAMPAIGN_KINDS = ["long_form", "quick"] as const;
export type CampaignKind = (typeof CAMPAIGN_KINDS)[number];
