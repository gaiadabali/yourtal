"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AUCTION_REFUSALS } from "@yourtal/contracts/auction/auction-refusals";
import { Button } from "@yourtal/ui/button";
import { Input } from "@yourtal/ui/input";
import { Notice } from "@yourtal/ui/notice";
import { placeBidAction } from "./auction-actions";
import { minorToBidInput, parseBidToMinor } from "./bid-amount";

export interface AuctionBidFormProps {
  auctionId: string;
  currency: "AUD" | "IDR";
  minimumNextBidMinor: number;
  /** Already formatted, e.g. "$21.00". */
  minimumLabel: string;
}

const KNOWN: ReadonlySet<string> = new Set(AUCTION_REFUSALS);

/**
 * 13.22.b/d: a bid in the region's currency. The server takes it only at or
 * above its own minimum; the hold goes through the simulated payment driver.
 */
export function AuctionBidForm({
  auctionId,
  currency,
  minimumNextBidMinor,
  minimumLabel,
}: AuctionBidFormProps) {
  const t = useTranslations("auction.bid");
  const router = useRouter();
  const [value, setValue] = useState(minorToBidInput(minimumNextBidMinor, currency));
  const [message, setMessage] = useState<{ tone: "danger" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountMinor = parseBidToMinor(value, currency);
    if (amountMinor === null) {
      setMessage({ tone: "danger", text: t(currency === "AUD" ? "invalidAud" : "invalidIdr") });
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = await placeBidAction(auctionId, amountMinor);
      if (result.ok) {
        setMessage({ tone: "success", text: t("placed") });
        setValue(minorToBidInput(result.auction.minimumNextBidMinor, currency));
        router.refresh();
        return;
      }
      setMessage({
        tone: "danger",
        text: KNOWN.has(result.code) ? t(`refusal.${result.code}`) : t("refusal.failed"),
      });
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Input
            name="amount"
            inputMode={currency === "AUD" ? "decimal" : "numeric"}
            label={t("label", { currency })}
            helpText={t("minimum", { amount: minimumLabel })}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            autoComplete="off"
          />
        </div>
        <Button type="submit" size="lg" loading={pending} className="mb-6">
          {t("submit")}
        </Button>
      </div>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <p className="text-caption font-sans text-fg-subtle">{t("fineprint")}</p>
    </form>
  );
}
