"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { BoostView } from "@yourtal/contracts/studio/boost";
import { Button } from "@yourtal/ui/button";
import { Notice } from "@yourtal/ui/notice";
import { stopBoost } from "./boost-actions";

export interface BoostStopProps {
  businessId: string;
  campaignId: string;
  setting: NonNullable<BoostView["setting"]>;
  onStopped: (view: BoostView) => void;
}

const DAY_MS = 86_400_000;

/**
 * 14.22.f: how to switch a boost off. Stopping keeps the setting (turn it back on with "Bidding on"
 * and Save) and says plainly that days already served are still charged.
 */
export function BoostStop({ businessId, campaignId, setting, onStopped }: BoostStopProps) {
  const t = useTranslations("studio.boost");
  const format = useFormatter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const endsAt = Date.parse(setting.endsAt);
  const running = setting.state === "active" && endsAt > Date.now();
  const endsSoon = running && endsAt - Date.now() <= DAY_MS;

  function stop(effective: "now" | "end_of_day") {
    setError(null);
    startTransition(async () => {
      const result = await stopBoost(businessId, campaignId, effective);
      if (!result.ok) return setError(result.message);
      onStopped(result.view);
    });
  }

  if (!running) {
    return (
      <Notice tone="info" title={t("stoppedTitle")}>
        {t("stoppedBody")} {t("stopCharged")}
      </Notice>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-control border border-border-subtle p-3">
      <p className="text-body font-sans font-semibold text-fg">{t("stopTitle")}</p>
      <p className="text-body-sm font-sans text-fg-muted">{t("stopCharged")}</p>
      {endsSoon ? (
        <p role="status" className="text-body-sm font-sans text-fg">
          {t("endsAtNotice", {
            when: format.dateTime(new Date(endsAt), { dateStyle: "medium", timeStyle: "short" }),
          })}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" disabled={pending} onClick={() => stop("now")}>
          {t("stopNow")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => stop("end_of_day")}
        >
          {t("stopEndOfDay")}
        </Button>
      </div>
      {error !== null ? (
        <p role="alert" className="text-body-sm font-sans text-danger-solid">
          {error}
        </p>
      ) : null}
    </div>
  );
}
