"use client";

import { useState, useTransition } from "react";
import type { FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@yourtal/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@yourtal/ui/dialog";
import { Input } from "@yourtal/ui/input";
import { MoneyAmount } from "@yourtal/ui/money-amount";
import { PointsChip } from "@yourtal/ui/points-chip";
import { Textarea } from "@yourtal/ui/textarea";
import { minorFromInput } from "../boost/money-input";
import { changeSettlementValueAction } from "./inventory-actions";
import type { SettlementChangeOutcome } from "./inventory-actions";
import { inventoryErrorKey } from "./inventory-errors";
import type { Currency } from "./listing-form";

export interface SettlementValueDialogProps {
  businessId: string;
  listingId: string;
  listingTitle: string;
  currency: Currency;
  settlementValueMinor: number;
  /** The platform-computed price; shown, never derived here. */
  priceInPoints: number;
}

/**
 * Changes a listing's settlement value S. A rise applies at once; a cut is filed
 * for a second approver. The API decides which; the screen only words the hint.
 */
export function SettlementValueDialog(props: SettlementValueDialogProps) {
  const t = useTranslations("studio");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SettlementChangeOutcome | null>(null);
  const [pending, startTransition] = useTransition();

  const newMinor = minorFromInput(value, props.currency);
  const hint =
    newMinor === null
      ? null
      : newMinor === props.settlementValueMinor
        ? "hintSame"
        : newMinor < props.settlementValueMinor
          ? "hintCut"
          : "hintRaise";
  const isCut = hint === "hintCut";
  const number = new Intl.NumberFormat(locale);

  function change(next: boolean) {
    setOpen(next);
    if (!next) {
      setValue("");
      setReason("");
      setFieldError(null);
      setFailure(null);
      setOutcome(null);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (newMinor === null) {
      setFieldError(t("inventory.form.error.amount"));
      return;
    }
    if (reason.trim() === "") {
      setFieldError(t("inventory.form.error.required"));
      return;
    }
    setFieldError(null);
    setFailure(null);
    startTransition(async () => {
      const result = await changeSettlementValueAction(
        props.businessId,
        props.listingId,
        newMinor,
        reason.trim(),
      );
      if (result.ok) setOutcome(result.value);
      else setFailure(t(`inventory.error.${inventoryErrorKey(result.code)}`));
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => change(true)}
        aria-label={t("inventory.changeValueFor", { title: props.listingTitle })}
      >
        {t("inventory.changeValue")}
      </Button>
      <Dialog open={open} onOpenChange={change}>
        <DialogContent closeLabel={t("inventory.cancel")}>
          <DialogHeader>
            <DialogTitle>{t("inventory.settlement.title")}</DialogTitle>
            <DialogDescription>
              {t("inventory.settlement.description", { title: props.listingTitle })}
            </DialogDescription>
          </DialogHeader>
          {outcome === null ? (
            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
              <dl className="grid grid-cols-2 gap-3 text-body-sm font-sans">
                <div className="flex flex-col gap-1">
                  <dt className="text-fg-muted">{t("inventory.settlement.current")}</dt>
                  <dd>
                    <MoneyAmount
                      amountMinor={props.settlementValueMinor}
                      currency={props.currency}
                      locale={locale}
                    />
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-fg-muted">{t("inventory.settlement.currentPrice")}</dt>
                  <dd>
                    <PointsChip
                      value={props.priceInPoints}
                      locale={locale}
                      formatLabel={(formatted) => t("billing.points", { formatted })}
                    />
                  </dd>
                </div>
              </dl>
              <Input
                label={t("inventory.settlement.newLabel", { currency: props.currency })}
                inputMode={props.currency === "IDR" ? "numeric" : "decimal"}
                value={value}
                disabled={pending}
                onChange={(event) => setValue(event.target.value)}
                {...(hint === null ? {} : { helpText: t(`inventory.settlement.${hint}`) })}
              />
              <Textarea
                label={t("inventory.settlement.reasonLabel")}
                helpText={t("inventory.settlement.reasonHelp")}
                value={reason}
                rows={2}
                maxLength={500}
                disabled={pending}
                onChange={(event) => setReason(event.target.value)}
              />
              {fieldError === null && failure === null ? null : (
                <p role="alert" className="text-body-sm font-sans text-danger-solid">
                  {fieldError ?? failure}
                </p>
              )}
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => change(false)}>
                  {t("inventory.cancel")}
                </Button>
                <Button type="submit" disabled={pending || hint === "hintSame"}>
                  {pending
                    ? t("inventory.settlement.working")
                    : isCut
                      ? t("inventory.settlement.request")
                      : t("inventory.settlement.apply")}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="flex flex-col gap-4">
              <p role="status" className="text-body font-sans text-fg">
                {outcome.kind === "applied"
                  ? t("inventory.settlement.applied", {
                      before: number.format(outcome.previousPriceInPoints),
                      after: number.format(outcome.priceInPoints),
                    })
                  : t("inventory.settlement.requested")}
              </p>
              <DialogFooter>
                <Button type="button" onClick={() => change(false)}>
                  {t("inventory.done")}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
