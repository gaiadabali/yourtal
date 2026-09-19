import type { ReactNode } from "react";
import { Card, CardContent } from "@yourtal/ui/card";
import { cn } from "@yourtal/ui/cn";

/**
 * The shared frame between `CampaignCard` and `CampaignCardSkeleton`
 * (YT-0410: "skeletons match final dimensions exactly so nothing shifts").
 *
 * Each row below is given a fixed height class. `CampaignCard` fills the
 * rows with real, possibly-overflowing text (`truncate` / `line-clamp-*`
 * keep it inside the row); `CampaignCardSkeleton` fills the exact same rows
 * with `Skeleton` blocks. Because both components render through this one
 * layout, a card can never render at a height its skeleton did not already
 * reserve — the frame is the single source of truth for the shape, not a
 * pair of hand-matched magic numbers in two files.
 */
export const CAMPAIGN_CARD_MERCHANT_ROW_CLASS = "h-4 overflow-hidden";
export const CAMPAIGN_CARD_TITLE_ROW_CLASS = "h-10 overflow-hidden";
export const CAMPAIGN_CARD_META_ROW_CLASS = "h-4 overflow-hidden";
export const CAMPAIGN_CARD_FOOTER_ROW_CLASS = "flex h-6 items-center justify-between gap-2 overflow-hidden";

export interface CampaignCardLayoutProps {
  merchantSlot: ReactNode;
  titleSlot: ReactNode;
  metaSlot: ReactNode;
  footerSlot: ReactNode;
  className?: string;
}

export function CampaignCardLayout({ merchantSlot, titleSlot, metaSlot, footerSlot, className }: CampaignCardLayoutProps) {
  return (
    <Card className={cn("flex h-full flex-col", className)}>
      <CardContent className="flex flex-1 flex-col gap-2 p-4">
        <div className={CAMPAIGN_CARD_MERCHANT_ROW_CLASS}>{merchantSlot}</div>
        <div className={CAMPAIGN_CARD_TITLE_ROW_CLASS}>{titleSlot}</div>
        <div className={CAMPAIGN_CARD_META_ROW_CLASS}>{metaSlot}</div>
        <div className={cn(CAMPAIGN_CARD_FOOTER_ROW_CLASS, "mt-auto")}>{footerSlot}</div>
      </CardContent>
    </Card>
  );
}
