"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { FeedItem } from "@yourtal/contracts/feed";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetDescription,
  BottomSheetHeader,
  BottomSheetTitle,
  BottomSheetTrigger,
} from "@yourtal/ui/bottom-sheet";
import { Button } from "@yourtal/ui/button";
import { notInterestedAction, setSavedAction } from "./feed-actions";
import { HideIcon, InfoIcon, SaveIcon, ShareIcon } from "./feed-icons";

export interface FeedItemActionsProps {
  item: Pick<FeedItem, "campaignId" | "title" | "merchantName" | "whyReason">;
  saved: boolean;
  onSavedChange: (saved: boolean) => void;
  shareUrl: string;
  onHidden: (campaignId: string) => void;
}

const RAIL_BUTTON =
  "flex h-auto w-16 flex-col items-center gap-1 whitespace-normal rounded-control bg-transparent p-1 text-center text-caption leading-tight font-sans text-white hover:bg-white/10";

/** Share, Save, Not interested and "Why am I seeing this?" (11.4.d). Nothing here is social. */
export function FeedItemActions({
  item,
  saved,
  onSavedChange,
  shareUrl,
  onHidden,
}: FeedItemActionsProps) {
  const t = useTranslations("feed");
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  const share = async () => {
    // A share carries only the public page: no referral, no reward (11.4.d).
    if (typeof navigator.share === "function") {
      await navigator.share({ title: item.title, url: shareUrl }).catch(() => undefined);
      return;
    }
    try {
      // Throws where the clipboard is unavailable (an insecure origin, say).
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const toggleSave = () => {
    const next = !saved;
    onSavedChange(next);
    startTransition(async () => {
      const result = await setSavedAction(item.campaignId, next);
      if (!result.ok) onSavedChange(!next);
    });
  };

  const hide = () => {
    startTransition(async () => {
      const result = await notInterestedAction(item.campaignId);
      if (result.ok) onHidden(item.campaignId);
    });
  };

  return (
    <div
      role="group"
      aria-label={t("actions.label", { title: item.title })}
      className="flex flex-col items-center gap-3"
    >
      <Button variant="ghost" className={RAIL_BUTTON} onClick={() => void share()}>
        <ShareIcon />
        <span>{copied ? t("actions.linkCopied") : t("actions.share")}</span>
      </Button>
      <Button
        variant="ghost"
        className={RAIL_BUTTON}
        aria-pressed={saved}
        onClick={toggleSave}
        disabled={pending}
      >
        <SaveIcon filled={saved} />
        <span>{saved ? t("actions.unsave") : t("actions.save")}</span>
      </Button>
      <Button variant="ghost" className={RAIL_BUTTON} onClick={hide} disabled={pending}>
        <HideIcon />
        <span>{t("actions.notInterested")}</span>
      </Button>
      <BottomSheet>
        <BottomSheetTrigger asChild>
          <Button variant="ghost" className={RAIL_BUTTON}>
            <InfoIcon />
            <span className="sr-only">{t("actions.why")}</span>
          </Button>
        </BottomSheetTrigger>
        <BottomSheetContent closeLabel={t("actions.close")}>
          <BottomSheetHeader>
            <BottomSheetTitle>{t("actions.why")}</BottomSheetTitle>
            <BottomSheetDescription>
              {t(`why.${item.whyReason}`, { merchantName: item.merchantName })}
            </BottomSheetDescription>
            <p className="pt-2 text-body-sm font-sans text-fg-muted">{t("why.footer")}</p>
          </BottomSheetHeader>
        </BottomSheetContent>
      </BottomSheet>
    </div>
  );
}
