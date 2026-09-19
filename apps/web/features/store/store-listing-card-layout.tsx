import type { ReactNode } from "react";
import { Card, CardContent } from "@yourtal/ui/card";
import { cn } from "@yourtal/ui/cn";

/**
 * The shared frame between `StoreListingCard` and `StoreListingCardSkeleton`
 * — the same "skeletons match final dimensions exactly so nothing shifts"
 * discipline as `campaign-card-layout.tsx`, applied to the Store grid.
 * Both components render through this one layout, so a card can never
 * render at a height its skeleton did not already reserve.
 */
export const STORE_CARD_MERCHANT_ROW_CLASS = "h-4 overflow-hidden";
export const STORE_CARD_TITLE_ROW_CLASS = "h-10 overflow-hidden";
export const STORE_CARD_META_ROW_CLASS = "h-4 overflow-hidden";
export const STORE_CARD_FOOTER_ROW_CLASS =
  "flex h-10 items-start justify-between gap-2 overflow-hidden";

export interface StoreListingCardLayoutProps {
  merchantSlot: ReactNode;
  titleSlot: ReactNode;
  metaSlot: ReactNode;
  footerSlot: ReactNode;
  className?: string;
}

export function StoreListingCardLayout({
  merchantSlot,
  titleSlot,
  metaSlot,
  footerSlot,
  className,
}: StoreListingCardLayoutProps) {
  return (
    <Card className={cn("flex h-full flex-col", className)}>
      <CardContent className="flex flex-1 flex-col gap-2 p-4">
        <div className={STORE_CARD_MERCHANT_ROW_CLASS}>{merchantSlot}</div>
        <div className={STORE_CARD_TITLE_ROW_CLASS}>{titleSlot}</div>
        <div className={STORE_CARD_META_ROW_CLASS}>{metaSlot}</div>
        <div className={cn(STORE_CARD_FOOTER_ROW_CLASS, "mt-auto")}>{footerSlot}</div>
      </CardContent>
    </Card>
  );
}
