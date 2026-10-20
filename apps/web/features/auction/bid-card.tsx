"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { BillingCard } from "@yourtal/contracts/billing";
import { Button } from "@yourtal/ui/button";
import { Notice } from "@yourtal/ui/notice";
import { startBidCardAction } from "./auction-actions";

const BRAND: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
};

/** True when a bid in this region charges a saved card and none is saved yet. */
export function needsCardToBid(card: BillingCard | null): boolean {
  return card !== null && card.required && card.card === null;
}

/** The card arrives with the processor's webhook: refresh every few seconds, then say it is still on its way. */
function RefreshWhileSaving({ stillWaiting }: { stillWaiting: string }) {
  const router = useRouter();
  const [left, setLeft] = useState(20);
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => {
      setLeft((n) => n - 1);
      router.refresh();
    }, 3_000);
    return () => clearTimeout(timer);
  }, [left, router]);
  return left <= 0 ? <p>{stillWaiting}</p> : null;
}

/**
 * 5.1.d: the card a bid holds, where the region's processor charges a saved card (AU on Stripe).
 * Without one the bidder adds it on the processor's own page and comes back here; with one, its
 * brand and last four digits show, and it can be replaced. Nothing shows where no card is needed.
 */
export function BidCard({
  auctionId,
  card,
  outcome,
}: {
  auctionId: string;
  card: BillingCard | null;
  /** `?card=` from the processor's page: saved, cancelled or failed. */
  outcome?: string | undefined;
}) {
  const t = useTranslations("auction.bid.card");
  if (card === null || !card.required) return null;
  const saved = card.card;

  const notice =
    outcome === "saved" ? (
      saved !== null ? (
        <Notice tone="success">{t("added")}</Notice>
      ) : (
        <Notice tone="info">
          <p>{t("saving")}</p>
          <RefreshWhileSaving stillWaiting={t("stillSaving")} />
        </Notice>
      )
    ) : outcome === "cancelled" ? (
      <Notice tone="warning">{t("cancelled")}</Notice>
    ) : outcome === "failed" ? (
      <Notice tone="danger">{t("failed")}</Notice>
    ) : null;

  return (
    <div className="flex flex-col gap-3">
      {notice}
      {saved === null ? (
        <Notice tone="info" title={t("title")}>
          <p>{t("why")}</p>
        </Notice>
      ) : (
        <p className="text-body-sm font-sans text-fg-muted">
          {t("saved", {
            brand: BRAND[saved.brand] ?? saved.brand,
            last4: saved.last4,
            month: String(saved.expMonth).padStart(2, "0"),
            year: String(saved.expYear).slice(-2),
          })}
        </p>
      )}
      <form action={startBidCardAction}>
        <input type="hidden" name="auctionId" value={auctionId} />
        <Button type="submit" variant={saved === null ? "primary" : "secondary"} size="md">
          {saved === null ? t("add") : t("replace")}
        </Button>
      </form>
    </div>
  );
}
