"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import { Text } from "@yourtal/ui/text";
import { acceptGiftAction, declineGiftAction } from "./gift-actions";

export interface GiftResponseButtonsProps {
  giftId: string;
  title: string;
}

/** 13.20.c: accept puts the voucher, with a fresh code, in the wallet; decline sends it back. */
export function GiftResponseButtons({ giftId, title }: GiftResponseButtonsProps) {
  const t = useTranslations("wallet.gift");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  function respond(accept: boolean) {
    setFailed(null);
    startTransition(async () => {
      const result = accept ? await acceptGiftAction(giftId) : await declineGiftAction(giftId);
      if (!result.ok) {
        setFailed(
          result.code === "gift_window_closed" || result.code === "gift_not_pending"
            ? t(`refusal.${result.code}`)
            : t("refusal.failed"),
        );
        return;
      }
      router.refresh();
      if (accept) router.push(`/wallet/voucher/${result.gift.voucherId}`);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Button
          onClick={() => respond(true)}
          loading={pending}
          aria-label={t("acceptLabel", { title })}
        >
          {t("accept")}
        </Button>
        <Button
          variant="ghost"
          onClick={() => respond(false)}
          disabled={pending}
          aria-label={t("declineLabel", { title })}
        >
          {t("decline")}
        </Button>
      </div>
      {failed ? (
        <Text size="body-sm" tone="danger" role="alert">
          {failed}
        </Text>
      ) : null}
    </div>
  );
}
