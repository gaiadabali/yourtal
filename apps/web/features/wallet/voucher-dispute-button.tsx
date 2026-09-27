"use client";

import { useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { DisputeReason, DisputeResult } from "@yourtal/contracts/checkout/dispute";
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
import { Text } from "@yourtal/ui/text";
import { disputeVoucherAction } from "./dispute-voucher-action";

const REASONS: DisputeReason[] = ["not_honoured", "merchant_closed", "other"];

export interface VoucherDisputeButtonProps {
  voucherId: string;
  /** Called once the dispute call settles, success or failure, so the page can show the outcome and refresh the balance/voucher state. */
  onResolved: (result: { ok: true; result: DisputeResult } | { ok: false }) => void;
}

/**
 * 4.7.c / K13, 6.5.b: "This voucher didn't work" — the one path a viewer has
 * to report a merchant refusing an unused voucher. A closed reason list
 * (`disputeReasonSchema`), never free text, so nothing a viewer types
 * reaches staff (docs' "no free text reaches staff from a viewer").
 */
export function VoucherDisputeButton({ voucherId, onResolved }: VoucherDisputeButtonProps) {
  const t = useTranslations("wallet");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<DisputeReason>("not_honoured");
  const [isPending, startTransition] = useTransition();
  const groupLabelId = useId();

  function submit() {
    startTransition(() => {
      void disputeVoucherAction(voucherId, reason).then((outcome) => {
        setOpen(false);
        onResolved(outcome.ok ? { ok: true, result: outcome.result } : { ok: false });
      });
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">{t("voucher.disputeCta")}</Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("voucher.disputeDialogClose")}>
        <DialogHeader>
          <Heading level={2} size="title">
            {t("voucher.disputeDialogTitle")}
          </Heading>
          <Text tone="muted">{t("voucher.disputeDialogBody")}</Text>
        </DialogHeader>
        <fieldset className="flex flex-col gap-2" aria-labelledby={groupLabelId}>
          <legend id={groupLabelId} className="text-body-sm font-sans font-medium text-fg">
            {t("voucher.disputeReasonLabel")}
          </legend>
          {REASONS.map((value) => (
            <ChoiceCard
              key={value}
              name="dispute-reason"
              value={value}
              title={t(`voucher.disputeReason.${value}`)}
              checked={reason === value}
              onChange={() => setReason(value)}
            />
          ))}
        </fieldset>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
            {t("voucher.disputeCancel")}
          </Button>
          <Button onClick={submit} loading={isPending}>
            {t("voucher.disputeSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
