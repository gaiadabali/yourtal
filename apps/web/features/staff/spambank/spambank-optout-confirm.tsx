"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import { Notice } from "@yourtal/ui/notice";
import { optOutAction } from "./spambank-optout-actions";

export interface SpambankOptoutConfirmProps {
  readonly domain: string;
  readonly sig: string;
}

/** The one button on the opt-out page. Opening the page does nothing; pressing this does. */
export function SpambankOptoutConfirm({ domain, sig }: SpambankOptoutConfirmProps) {
  const t = useTranslations("staff.spambank.optout");
  const [outcome, setOutcome] = useState<"idle" | "done" | "invalid" | "unavailable">("idle");
  const [pending, startTransition] = useTransition();

  if (outcome === "done") {
    return (
      <Notice tone="success" title={t("doneTitle")}>
        {t("done", { domain })}
      </Notice>
    );
  }
  if (outcome === "invalid") {
    return (
      <Notice tone="danger" title={t("invalidTitle")}>
        {t("invalid")}
      </Notice>
    );
  }

  return (
    <div className="flex flex-col items-start gap-3">
      {outcome === "unavailable" ? <Notice tone="danger">{t("error")}</Notice> : null}
      <Button
        loading={pending}
        onClick={() =>
          startTransition(() => {
            void optOutAction(domain, sig).then(setOutcome);
          })
        }
      >
        {t("confirm", { domain })}
      </Button>
    </div>
  );
}
