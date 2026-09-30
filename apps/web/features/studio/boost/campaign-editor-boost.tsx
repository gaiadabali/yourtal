"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { BoostView, SetBoostRequest } from "@yourtal/contracts/studio/boost";
import { Button } from "@yourtal/ui/button";
import { Input } from "@yourtal/ui/input";
import { MoneyAmount } from "@yourtal/ui/money-amount";
import { Switch } from "@yourtal/ui/switch";
import { loadBoost, saveBoost } from "./boost-actions";
import { minorFromInput, inputFromMinor } from "./money-input";

export interface CampaignEditorBoostProps {
  businessId: string;
  campaignId: string;
  isLive: boolean;
  isLiveMode: boolean;
}

const DAY_MS = 86_400_000;
const dateOf = (iso: string) => iso.slice(0, 10);
const isoOf = (date: string) => new Date(`${date}T00:00:00.000Z`).toISOString();

/**
 * 13.23.a: a live campaign's Boost setting — a daily cash budget and a
 * maximum bid per 1,000 boosted impressions, in the business's currency —
 * and what it has delivered (13.23.d). Boost is paid in cash, apart from
 * points, and never changes what a viewer earns.
 */
export function CampaignEditorBoost(props: CampaignEditorBoostProps) {
  const t = useTranslations("studio");
  const [view, setView] = useState<BoostView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [budget, setBudget] = useState("");
  const [bid, setBid] = useState("");
  const [startsAt, setStartsAt] = useState(dateOf(new Date().toISOString()));
  const [endsAt, setEndsAt] = useState(dateOf(new Date(Date.now() + 14 * DAY_MS).toISOString()));
  const [active, setActive] = useState(true);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!props.isLiveMode || !props.isLive) return;
    void loadBoost(props.businessId, props.campaignId).then((result) => {
      if (!result.ok) return setError(result.message);
      setView(result.view);
      const setting = result.view.setting;
      if (setting !== null) {
        setBudget(inputFromMinor(setting.dailyBudgetMinor, result.view.currency));
        setBid(inputFromMinor(setting.maxBidCpmMinor, result.view.currency));
        setStartsAt(dateOf(setting.startsAt));
        setEndsAt(dateOf(setting.endsAt));
        setActive(setting.state === "active");
      }
    });
  }, [props.businessId, props.campaignId, props.isLive, props.isLiveMode]);

  if (!props.isLive) {
    return <p className="text-body-sm font-sans text-fg-muted">{t("boost.notLive")}</p>;
  }
  if (view === null) {
    return (
      <p
        role={error === null ? "status" : "alert"}
        className="text-body-sm font-sans text-fg-muted"
      >
        {error ?? t("boost.loading")}
      </p>
    );
  }

  const currency = view.currency;
  function save() {
    const dailyBudgetMinor = minorFromInput(budget, currency);
    const maxBidCpmMinor = minorFromInput(bid, currency);
    if (dailyBudgetMinor === null || maxBidCpmMinor === null) {
      setError(t("boost.invalidAmount"));
      return;
    }
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveBoost(props.businessId, props.campaignId, {
        dailyBudgetMinor: dailyBudgetMinor as SetBoostRequest["dailyBudgetMinor"],
        maxBidCpmMinor: maxBidCpmMinor as SetBoostRequest["maxBidCpmMinor"],
        startsAt: isoOf(startsAt),
        endsAt: isoOf(endsAt),
        state: active ? "active" : "paused",
      });
      if (!result.ok) return setError(result.message);
      setView(result.view);
      setSaved(true);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-body-sm font-sans text-fg-muted">
        {t("boost.intro")}{" "}
        {t("boost.reserve", { amount: inputFromMinor(view.reserveCpmMinor, currency), currency })}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label={t("boost.dailyBudget", { currency })}
          inputMode="decimal"
          value={budget}
          disabled={pending}
          onChange={(event) => setBudget(event.target.value)}
        />
        <Input
          label={t("boost.maxBid", { currency })}
          inputMode="decimal"
          value={bid}
          disabled={pending}
          onChange={(event) => setBid(event.target.value)}
        />
        <Input
          label={t("boost.startsAt")}
          type="date"
          value={startsAt}
          disabled={pending}
          onChange={(event) => setStartsAt(event.target.value)}
        />
        <Input
          label={t("boost.endsAt")}
          type="date"
          value={endsAt}
          disabled={pending}
          onChange={(event) => setEndsAt(event.target.value)}
        />
      </div>
      <Switch
        label={t("boost.active")}
        checked={active}
        disabled={pending}
        onCheckedChange={setActive}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={save} disabled={pending}>
          {t("boost.save")}
        </Button>
        {error !== null ? (
          <p role="alert" className="text-body-sm font-sans text-danger-solid">
            {error}
          </p>
        ) : saved ? (
          <p role="status" className="text-body-sm font-sans text-fg-muted">
            {t("boost.saved")}
          </p>
        ) : null}
      </div>
      <dl className="grid grid-cols-3 gap-3 rounded-control border border-border-subtle p-3">
        <div>
          <dt className="text-xs font-sans text-fg-muted">{t("boost.impressions")}</dt>
          <dd className="text-body font-sans text-fg">{view.impressions}</dd>
        </div>
        <div>
          <dt className="text-xs font-sans text-fg-muted">{t("boost.spend")}</dt>
          <dd className="text-body font-sans text-fg">
            <MoneyAmount amountMinor={view.spendMinor} currency={currency} />
          </dd>
        </div>
        <div>
          <dt className="text-xs font-sans text-fg-muted">{t("boost.averagePrice")}</dt>
          <dd className="text-body font-sans text-fg">
            {view.averageCpmMinor === null ? (
              "—"
            ) : (
              <MoneyAmount amountMinor={view.averageCpmMinor} currency={currency} />
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}
