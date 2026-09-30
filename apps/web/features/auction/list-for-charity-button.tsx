"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { HeartHandshake } from "lucide-react";
import { AUCTION_REFUSALS } from "@yourtal/contracts/auction/auction-refusals";
import type { PublicCharity } from "@yourtal/contracts/charity/charity";
import { Button } from "@yourtal/ui/button";
import { ChoiceCard } from "@yourtal/ui/choice-card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from "@yourtal/ui/dialog";
import { Heading } from "@yourtal/ui/heading";
import { Notice } from "@yourtal/ui/notice";
import { Text } from "@yourtal/ui/text";
import { CharityLogo } from "@/features/charity/charity-logo";
import { listVoucherAction } from "./auction-actions";

export interface ListForCharityButtonProps {
  voucherId: string;
  charities: readonly PublicCharity[];
}

const KNOWN: ReadonlySet<string> = new Set(AUCTION_REFUSALS);

/**
 * 13.22.a/d (F86): put an unused voucher up for a charity auction. The code
 * stops working at once; the winner's payment goes straight to the charity.
 */
export function ListForCharityButton({ voucherId, charities }: ListForCharityButtonProps) {
  const t = useTranslations("auction.list");
  const tc = useTranslations("charity");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [charityId, setCharityId] = useState(charities[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await listVoucherAction(voucherId, charityId);
      if (result.ok) {
        router.push(`/auctions/${result.auction.auctionId}`);
        return;
      }
      setError(KNOWN.has(result.code) ? t(`refusal.${result.code}`) : t("refusal.failed"));
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" className="gap-2">
          <HeartHandshake aria-hidden="true" className="h-4 w-4" />
          {t("cta")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("close")}>
        <DialogHeader>
          <Heading level={2} size="title">
            {t("title")}
          </Heading>
          <Text tone="muted">{t("intro")}</Text>
        </DialogHeader>
        {charities.length === 0 ? (
          <Notice tone="info">{t("noCharities")}</Notice>
        ) : (
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="mb-2 text-body-sm font-sans font-semibold text-fg">
              {t("pick")}
            </legend>
            <div className="flex max-h-64 flex-col gap-2 overflow-y-auto pr-1">
              {charities.map((charity) => (
                <ChoiceCard
                  key={charity.id}
                  name="charity"
                  value={charity.id}
                  title={charity.name}
                  description={`${tc(`cause.${charity.cause}`)} · ${charity.summary}`}
                  media={<CharityLogo charity={charity} size="md" />}
                  checked={charityId === charity.id}
                  onChange={() => setCharityId(charity.id)}
                />
              ))}
            </div>
          </fieldset>
        )}
        <ul className="flex list-disc flex-col gap-1 pl-5 text-body-sm font-sans text-fg-muted">
          <li>{t("ruleCode")}</li>
          <li>{t("ruleLength")}</li>
          <li>{t("ruleMoney")}</li>
        </ul>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button onClick={submit} loading={pending} disabled={charityId === ""}>
            {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
