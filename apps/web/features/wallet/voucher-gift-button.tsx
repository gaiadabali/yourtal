"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Gift } from "lucide-react";
import { WALLET_GIFT_REFUSALS } from "@yourtal/contracts/wallet/wallet-gift-refusals";
import { Button } from "@yourtal/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from "@yourtal/ui/dialog";
import { Heading } from "@yourtal/ui/heading";
import { Input } from "@yourtal/ui/input";
import { Notice } from "@yourtal/ui/notice";
import { Text } from "@yourtal/ui/text";
import { giftVoucherAction } from "./gift-actions";
import { formatWalletDate, type SupportedLocale } from "./wallet-format";

export interface VoucherGiftButtonProps {
  voucherId: string;
  locale: SupportedLocale;
}

const KNOWN: ReadonlySet<string> = new Set(WALLET_GIFT_REFUSALS);

/**
 * 13.20.c (F86): give this voucher, once, to another adult YourTal member in
 * the same region, by email. There is no message field and nothing about the
 * recipient is ever shown back. The code stops working the moment it is sent.
 */
export function VoucherGiftButton({ voucherId, locale }: VoucherGiftButtonProps) {
  const t = useTranslations("wallet.gift");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sentUntil, setSentUntil] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await giftVoucherAction(voucherId, email.trim());
      if (result.ok) {
        setSentUntil(result.gift.acceptBy);
        return;
      }
      setError(KNOWN.has(result.code) ? t(`refusal.${result.code}`) : t("refusal.failed"));
    });
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    // Once sent, this page's code is dead: leave for the wallet.
    if (!next && sentUntil) router.push("/wallet#gifts");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="secondary" className="gap-2">
          <Gift aria-hidden="true" className="h-4 w-4" />
          {t("cta")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("close")}>
        {sentUntil ? (
          <>
            <DialogHeader>
              <Heading level={2} size="title">
                {t("sentTitle")}
              </Heading>
              <Text tone="muted">
                {t("sentBody", { date: formatWalletDate(sentUntil, locale) })}
              </Text>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>{t("backToWallet")}</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <Heading level={2} size="title">
                {t("title")}
              </Heading>
              <Text tone="muted">{t("intro")}</Text>
            </DialogHeader>
            <Input
              type="email"
              name="recipientEmail"
              label={t("emailLabel")}
              helpText={t("emailHelp")}
              autoComplete="off"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <ul className="flex list-disc flex-col gap-1 pl-5 text-body-sm font-sans text-fg-muted">
              <li>{t("ruleCode")}</li>
              <li>{t("ruleWindow")}</li>
              <li>{t("ruleOnce")}</li>
            </ul>
            {error ? <Notice tone="danger">{error}</Notice> : null}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                {t("cancel")}
              </Button>
              <Button type="submit" loading={pending} disabled={email.trim() === ""}>
                {t("send")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
